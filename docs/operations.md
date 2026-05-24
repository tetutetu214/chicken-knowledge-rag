# Operations Run Book — Chicken Knowledge RAG System

「滅多に触らないが、触る時に手順を忘れていると事故る運用」をまとめた Run Book。日常開発フロー (`docs/todo.md`「主要コマンド」) でカバーしきれない、年単位の低頻度オペや緊急時手順をここに集約する。

このファイルの位置付けは「次回セッションの自分 / 配偶者・将来の引き継ぎ相手が手順を即引ける単一参照点」。実例・過去事故を `docs/knowledge.md` の該当日付エントリへリンクで紐づけているので、判断根拠は必ずそちらと併読すること。

---

## 目次

1. [Amplify Hosting 反映フロー](#1-amplify-hosting-反映フロー)
2. [Bedrock KB チャンキング戦略の変更手順](#2-bedrock-kb-チャンキング戦略の変更手順)
3. [Embedding Model の移行手順](#3-embedding-model-の移行手順)
4. [DataSource (docs バケット) の入れ替え手順](#4-datasource-docs-バケット-の入れ替え手順)
5. [緊急時: Stack 削除と KB 救出](#5-緊急時-stack-削除と-kb-救出)

---

## 1. Amplify Hosting 反映フロー

### 1-1. 基本構造

Amplify Hosting (本番) は `AMPLIFY_OUTPUTS_GZ_B64` という単一の環境変数 (gzip+base64 化した `amplify_outputs.json` 約 2.3K 文字) を持っており、ビルド時に `amplify.yml` の preBuild で `base64 -d | gunzip > web/amplify_outputs.json` して復元している。

つまり「本番が見ている AppSync スキーマ・Cognito ID・Lambda 名」は、この env の世代に固定される。env を更新しない限り、ローカル sandbox を何度回しても本番には反映されない。

| ファイル | 役割 |
|---|---|
| `package.json` の `scripts.sandbox` | ampx sandbox 実行 + `sync-outputs-env.mjs` の呼び出し |
| `package.json` の `scripts.sandbox:full` | sandbox 2 回ループで env 更新 → Hosting 反映までを一括実行 |
| `scripts/sync-outputs-env.mjs` | `web/amplify_outputs.json` を gzip+base64 化 → `~/.secrets/chicken-knowledge-rag.env` の `AMPLIFY_OUTPUTS_GZ_B64` 行を上書き |
| `amplify/infra/hosting.ts` | env を読んで Amplify Hosting App の環境変数として CDK で渡す |
| `amplify.yml` (リポジトリルート) | preBuild で base64 -d | gunzip して復元 |

### 1-2. 通常の sandbox 再デプロイ (バックエンドの差分だけ)

スキーマや Lambda コードに変更がなく、純粋にバックエンドの設定 (IAM / env / nested stack 構成など) だけを変えた場合:

```bash
source ~/.secrets/chicken-knowledge-rag.env
npm run sandbox
```

これで `ampx sandbox --once` が動き、続けて `sync-outputs-env.mjs` が env を上書きする。次回の sandbox 実行で Hosting App env が更新される。GitHub への push を伴う場合、Hosting Auto Build が走り本番に反映される。

### 1-3. 即時に本番反映したい (スキーマ変更を伴う本番反映)

`web/amplify_outputs.json` の中身 (AppSync introspection・Cognito ID・Lambda 名など) が変わったときは、Hosting App env も同じタイミングで更新する必要がある。1 回目の sandbox で env を更新し、2 回目の sandbox でその更新を Hosting に反映する。これを 1 コマンドで回すのが `npm run sandbox:full`。

```bash
source ~/.secrets/chicken-knowledge-rag.env
npm run sandbox:full
```

所要時間は約 4 分 (sandbox 1 周あたり 1〜2 分 × 2)。本番への反映確認は次のいずれかで行う:

- Amplify Hosting コンソール → 該当 App → 最新ビルドが `SUCCEED` で完了しているか
- 本番 URL (`~/.secrets/chicken-knowledge-rag.env` の `AMPLIFY_HOSTING_URL`) を開いて、スキーマ変更が反映された動作を目視

### 1-4. 世代ズレ事故 (2026-05-16 発生済み、対策済み)

#### 症状

ローカル `npm run dev` では新スキーマで動くが、本番だけ「フィールドが見つからない」「selection set に存在しない」エラーで壊れる。

#### 原因

`npx ampx sandbox --once --outputs-out-dir web` を素で叩いて env 同期 (`sync-outputs-env.mjs`) を忘れると、Hosting App env が古いまま固定され、preBuild で復元される `amplify_outputs.json` も古い世代になる。

#### 対策 (恒久)

- **`npx ampx sandbox` を直接叩かない**。必ず `npm run sandbox` または `npm run sandbox:full` を経由する (package.json の script に集約済み)。
- 世代ズレ事故の歴史的詳細は `docs/knowledge.md` 2026-05-16「Amplify Hosting と sandbox の世代ズレ事故とその構造」参照。

#### リカバリ手順 (もし世代ズレが起きてしまったら)

1. ローカルで `web/amplify_outputs.json` が最新であることを確認 (`npx ampx sandbox --once --outputs-out-dir web` を再度実行)
2. `node scripts/sync-outputs-env.mjs` を手動実行して env を更新
3. `source ~/.secrets/chicken-knowledge-rag.env && npx ampx sandbox --once --outputs-out-dir web` で Hosting App env を反映
4. Amplify Hosting コンソールで「Redeploy this version」をクリック、または GitHub に空 commit を push して再ビルドを発火

### 1-5. ローカル E2E では世代ズレを検知できない

`web/tests/*.spec.ts` の Playwright E2E はローカルの `web/amplify_outputs.json` を使うため、Hosting App env が古くても合格する。本番反映後は必ず手動 smoke (実機でログイン → 新機能の golden path 確認) を行うこと。

---

## 2. Bedrock KB チャンキング戦略の変更手順

### 2-1. 前提

**チャンキング戦略は CfnDataSource 作成後に変更不可** (`docs/knowledge.md` 2026-05-02 参照)。CFn 上はプロパティ更新を試みるとデプロイ失敗するため、戦略変更は **新 DataSource 作成 → Ingestion → 旧 DataSource 削除** で行う。

- 戦略変更例: `HIERARCHICAL` → `SEMANTIC` への切替、`parent 1500 / child 300` → `parent 2000 / child 400` への調整、`overlapTokens` の変更など
- KB ID は変わらないため Lambda env (`KB_ID`) の更新は不要
- 既存ベクトルは旧 DataSource にぶら下がるため、削除前に新 DataSource での Ingestion 完了を確認すること

### 2-2. 手順 (チェックリスト)

1. **事前確認**
   - [ ] 変更したい新しいチャンキング戦略を `spec.md` §3-3 または `knowledge.md` に追記して根拠を残す
   - [ ] 現状の KB ID と DataSource ID をメモ (`~/.secrets/chicken-knowledge-rag.env` の `AMPLIFY_OUTPUTS_GZ_B64` を展開、もしくは Bedrock コンソール)
   - [ ] アクティブな家族会話がないことを Amplify Hosting コンソールで確認 (アクセスログ)
2. **新 DataSource を CDK で追加**
   - [ ] `amplify/infra/knowledge-base.ts` に `DataSourceV3` (新論理 ID) を追加し、新しい chunking 設定を入れる
   - [ ] 既存の `DataSource` は残したまま (削除しない)。KB に複数 DataSource をぶら下げる構成
   - [ ] `removalPolicy: RETAIN` を新 DataSource にも明示
3. **デプロイ**
   - [ ] てつてつが `aws login` 実行 → `aws sts get-caller-identity` で認証確認
   - [ ] `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox:full`
   - [ ] Amplify Hosting ビルドが SUCCEED まで待つ
4. **Ingestion 実行**
   - [ ] `aws bedrock-agent start-ingestion-job --knowledge-base-id <KB_ID> --data-source-id <新 DS_ID> --region ap-northeast-1`
   - [ ] `aws bedrock-agent get-ingestion-job --knowledge-base-id <KB_ID> --data-source-id <新 DS_ID> --ingestion-job-id <JOB_ID>` で COMPLETE を待つ (14 本程度なら数分)
5. **新 DataSource で疎通確認**
   - [ ] 本番 URL で代表 3 質問 (KB ヒットあり / KB ヒットなし / 微妙な閾値) を投げて引用元・回答品質を目視
   - [ ] CloudWatch Logs で `topScore` 分布が想定範囲か確認
6. **旧 DataSource 削除 (オプション、即時必須ではない)**
   - [ ] 1 週間ほど並行稼働させて新 DS が安定していることを確認後、`amplify/infra/knowledge-base.ts` から旧 `DataSource` を削除
   - [ ] `RETAIN` ポリシーで AWS 上に残るので、`aws bedrock-agent delete-data-source` で明示削除
   - [ ] 旧 DS にぶら下がっていたベクトルは自動で削除される
7. **ドキュメント更新**
   - [ ] `docs/knowledge.md` に変更日付・新 DS_ID・性能差 (topScore 分布) を記録

### 2-3. 関連する過去事例

- `docs/knowledge.md` 2026-05-02「チャンキングは Hierarchical (parent 1500 / child 300 / overlap 60)」 — 初期設定の根拠
- `docs/knowledge.md` 2026-05-03「Bedrock KB Replacement 時の名前衝突問題」 — `-v2` サフィックス必須化の経緯

---

## 3. Embedding Model の移行手順

### 3-1. 前提

Embedding model 変更は **KB 全体の CFn Replacement** を伴う。理由:

- `CfnKnowledgeBase.knowledgeBaseConfiguration.vectorKnowledgeBaseConfiguration.embeddingModelArn` は immutable プロパティ。CFn が「新 KB 作成 → 旧 KB 削除」を試みる
- 旧 KB は `RemovalPolicy.RETAIN` で守られているため AWS 上に残るが、CFn 上の管理からは外れる
- KB ID が変わるため Lambda env (`KB_ID`) の手動更新が必要 (todo.md / knowledge.md 2026-05-23 参照)
- ベクトル次元数が変わる場合 (例: 1024d → 1536d) は VectorIndex も再作成が必要

「環境変数 1 行 (`EMBEDDING_MODEL_ID`) を変えるだけ」で済む見た目だが、実体は数時間〜半日仕事になる。安易に変更しないこと。

### 3-2. 手順 (チェックリスト)

1. **事前確認**
   - [ ] 新 embedding model の次元数・最大トークン数・対応言語を AWS Bedrock コンソールで確認
   - [ ] 現状の VectorIndex の `dimension` (1024) と整合するか確認。整合しない場合は VectorIndex も `-v3` サフィックスで作り直す手順を追加
   - [ ] Bedrock コンソールで新モデルのアクセスを有効化 (Anthropic 系は要承認、Amazon Titan 系は不要)
2. **CDK 変更**
   - [ ] `~/.secrets/chicken-knowledge-rag.env` の `EMBEDDING_MODEL_ID` を新モデル ID に変更
   - [ ] 必要なら `amplify/infra/knowledge-base.ts` の `CfnKnowledgeBase` `name` と `CfnDataSource` `name` に新サフィックス (`-v3` 等) を付与して衝突回避
   - [ ] 同じく `CfnVectorBucket` / `CfnIndex` も dimension が変わる場合は新論理 ID + 新 indexName に
3. **デプロイ前の最終確認**
   - [ ] `npx ampx sandbox` の synth でテンプレート差分を目視
   - [ ] 「新 KB / 新 Index 作成 + 旧リソースは RETAIN で残置」の構造になっているか確認
4. **デプロイ**
   - [ ] `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox`
   - [ ] Bedrock KB の Replacement は 30 秒〜数分程度
5. **Ingestion 実行**
   - [ ] 新 KB の DataSource ID で `start-ingestion-job`
   - [ ] COMPLETE まで待つ (14 本で数分)
6. **Lambda env を新 KB ID に更新**
   - [ ] `amplify/functions/chat-handler/resource.ts` および evaluation 系の env を新 KB ID に更新
   - [ ] 再 sandbox で Lambda 再デプロイ
7. **疎通確認**
   - [ ] 本番で代表質問 3 件を投げて回答品質を目視
   - [ ] `topScore` の分布が旧 model と大幅に変わっていないか CloudWatch Logs で確認 (変わっていたら閾値 0.7 の見直しも検討)
8. **旧 KB の明示削除 (1 週間ほど並行稼働させた後)**
   - [ ] `aws bedrock-agent delete-knowledge-base --knowledge-base-id <旧 KB_ID>` で削除
   - [ ] 旧 VectorIndex / VectorBucket も使われていないなら `aws s3vectors delete-index` / `aws s3vectors delete-vector-bucket` で削除
9. **ドキュメント更新**
   - [ ] `docs/knowledge.md` に変更日付・旧/新 model ID・移行コスト・性能差を記録
   - [ ] `CLAUDE.md` の技術スタック表も更新

### 3-3. 関連する過去事例

- `docs/knowledge.md` 2026-05-23「Issue #31 (env 化と共通ヘルパー化) 完了」 — `EMBEDDING_MODEL_ID` を env 化した経緯。env を変えただけでは CFn diff が発生しない (no-op) ことも記載
- `docs/knowledge.md` 2026-05-03「Bedrock KB Replacement 時の名前衝突問題」 — `-v2` サフィックス必須

---

## 4. DataSource (docs バケット) の入れ替え手順

### 4-1. 前提

S3 docs-bucket そのものを別バケットに切り替えたい (例: アカウント移行、命名規則変更、別ドキュメントセットへの差し替え) ケース。

- `CfnDataSource.dataSourceConfiguration.s3Configuration.bucketArn` は update 可能だが、変更すると **既存ベクトルが孤児化** する。新バケットを参照する新 DataSource を作って Ingestion し直す方が安全
- KB ID は変わらないため Lambda env の更新は不要

### 4-2. 手順 (チェックリスト)

1. **事前確認**
   - [ ] 新 docs バケットの IAM 設定 (KB サービスロールに `s3:GetObject` 権限あるか) を確認
   - [ ] 新バケットにドキュメントをアップロード済みか確認
2. **新 DataSource を CDK で追加**
   - [ ] `amplify/infra/knowledge-base.ts` に `DataSourceV4` (新論理 ID、新バケット参照) を追加
   - [ ] 既存の `DataSource` は残したまま
   - [ ] `removalPolicy: RETAIN` を明示
3. **デプロイ**
   - [ ] `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox:full`
4. **Ingestion 実行**
   - [ ] 新 DataSource ID で `start-ingestion-job` → COMPLETE まで待つ
5. **疎通確認**
   - [ ] 新ドキュメントから引用されることを本番で確認
6. **旧 DataSource 削除 (1 週間ほど並行稼働後)**
   - [ ] CDK から旧 `DataSource` 構成削除 + `aws bedrock-agent delete-data-source` で明示削除
   - [ ] 旧バケットも不要なら `aws s3 rb --force` で削除 (RETAIN ポリシーで CDK 削除では消えない)
7. **ドキュメント更新**
   - [ ] `docs/knowledge.md` に切り替え日付・新バケット名・移行理由を記録

---

## 5. 緊急時: Stack 削除と KB 救出

### 5-1. Sandbox を本番として共有運用しているリスク

本プロジェクトは Amplify Gen2 公式推奨の「Sandbox 開発 / pipeline-deploy 本番」分離を採用せず、**Sandbox 環境を本番として共有運用**している (`docs/knowledge.md` 2026-05-04「Sandbox を本番として共有運用 (KB 二重作成回避)」参照)。

これにより:

- `npx ampx sandbox delete` を実行すると Amplify Hosting も停止する → **絶対に実行禁止** (`docs/todo.md` 既知の制約参照)
- Stack 削除 (誤った CLI 操作、CloudFormation Console での手動 Delete Stack など) が起きると Cognito / DynamoDB / Lambda / AppSync が一気に消える

### 5-2. RemovalPolicy.RETAIN で守られているリソース (Issue #33 で明示化済み)

Stack 削除しても以下は AWS 上に残る:

| リソース | 論理 ID | 物理名の例 |
|---|---|---|
| S3 Vectors VectorBucket | `VectorBucket` | `chicken-rag-vectors-<accountId>-ap-northeast-1` |
| S3 Vectors Index | `VectorIndexV2` | `chicken-rag-index-v2` |
| Bedrock Knowledge Base | `KnowledgeBase` | `chicken-knowledge-rag-kb-v2` |
| Bedrock DataSource | `DataSource` | `chicken-rag-docs-datasource-v2` |
| S3 docs バケット | `DocsBucket` 系 | `chicken-rag-docs-<accountId>-ap-northeast-1` |
| S3 knowledge バケット | `KnowledgeBucket` 系 | `chicken-rag-knowledge-<accountId>-ap-northeast-1` |

つまり「14 本のドキュメントとベクトルインデックスは無事」。失われるのは Cognito ユーザー (User1/User2 のパスワード) と DynamoDB (会話履歴・要約) と Lambda コードだけ。

### 5-3. Stack 削除が起きた場合のリカバリ手順

1. **被害確認**
   - [ ] CloudFormation コンソールで `amplify-chickenknowledgerag-*` Stack が DELETE_COMPLETE になっていないか確認
   - [ ] 上記 RETAIN リソースが AWS 上に残っているか確認 (`aws bedrock-agent list-knowledge-bases` 等)
2. **CDK 再デプロイ**
   - [ ] リポジトリを clone (新環境の場合) し、`~/.secrets/chicken-knowledge-rag.env` を復元
   - [ ] `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox`
   - [ ] CDK が新しく KB / Index / Bucket を作ろうとすると、RETAIN で残った旧リソースと **同名衝突** で失敗する。これが起きたら、CDK 側の `name` プロパティに `-v3` 等のサフィックスを付けて新規作成 (`docs/knowledge.md` 2026-05-03 参照)
3. **既存リソースを CDK 管理下に戻すか、新規作成して切り替えるかの判断**
   - **戻す**: `aws cloudformation register-type` + 手動 import が必要、面倒
   - **新規作成して切り替える (推奨)**: 上記 2 のサフィックス変更で新規作成 → 新 KB に Ingestion → Lambda env を新 KB ID に更新 → 動作確認後に旧リソースを `aws bedrock-agent delete-knowledge-base` で明示削除
4. **Cognito ユーザー再作成**
   - [ ] `aws cognito-idp admin-create-user` で User1/User2 を再作成 (`docs/todo.md` Step 5 の手順参照)
5. **DynamoDB 履歴の再蓄積**
   - [ ] 履歴は失われるが、TTL 90 日の運用なので家族にアナウンスして新規スタート

### 5-4. 関連する過去事例

- `docs/knowledge.md` 2026-05-04「Sandbox を本番として共有運用 (KB 二重作成回避)」 — Stack 削除禁止の根拠
- `docs/knowledge.md` 2026-05-02「CDK Bootstrap の孤児状態と復旧手順」 — RETAIN リソースの孤児化と復旧の一般論

---

## 関連参照

- `docs/todo.md` 「主要コマンド」「既知の制約」 — 日常開発フロー
- `docs/knowledge.md` — 各日付エントリに過去事故と判断根拠
- `docs/spec.md` §3-3 — チャンキング設定の根拠
- `CLAUDE.md` — 技術スタック・インフラ構成
- `amplify/infra/knowledge-base.ts` — RemovalPolicy.RETAIN の明示箇所 (Issue #33)
- `amplify/infra/hosting.ts` — Amplify Hosting CDK 定義 + 反映フローへの参照コメント
- `scripts/sync-outputs-env.mjs` — `AMPLIFY_OUTPUTS_GZ_B64` の自動同期スクリプト
