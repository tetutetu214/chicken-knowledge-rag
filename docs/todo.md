# タスク管理 — Chicken Knowledge RAG System

最新状態を保つこと。完了したらチェックを入れて、必要なら新規タスクを追加する。詳細は `spec.md` §9 を参照。

## 次回再開時のチェックリスト

最終更新: 2026-05-23 (Issue #31 完了 — PR #60 `feature/issue-31-env-cleanup` で `amplify/functions/_shared/env.ts` 新規 + chat/summarize handler を init-time throw に統一 + EMBEDDING_MODEL_ID を env 化。CFn 検証で KB は no-op (env デフォルト値完全一致のため CFn diff なし) を確認、Lambda 2 個のみ更新、sandbox apply 85 秒 UPDATE_COMPLETE、Amplify Hosting Job #53 SUCCEED。前回: 月額予算上限を $30 → $15 に引き下げ (Cost Explorer 実測 $5/月)、Issue #34 を主要部分実装済みでクローズして #33 にスコープ統合、Issue #29 を起票時前提解消済みでクローズ。次は #32 (Cognito sign-up 無効化を CDK で明示化) を予定 (推奨着手順: #32 → #33 → #30))

### 次回セッション開始時にやること

1. **着手対象を選択** (下記「現状の優先度」参照)
2. **環境準備**: `source ~/.secrets/chicken-knowledge-rag.env`（毎回必須）
3. **sandbox 実行時の注意**: 必ず `npx ampx sandbox --outputs-out-dir web` で実行する（amplify_outputs.json を web/ 配下に出力する設計）

### KB 拡充の3経路 (重要前提・2026-05-05 確定)

すべての KB 拡充タスクはこの3経路のどれかに対応する。混同しないこと。

| # | 経路 | 入口 | 出口 | 責任主体 | 関連 |
|---|---|---|---|---|---|
| **[1]** | 公的資料追加 | てつてつが資料を探す | S3 docs-bucket → 自動 Ingestion | てつてつ (人手) | 既存運用 (新規実装不要) |
| **[2]** | 家族ナレッジ追加 | 会話駆動抽出 + 承認 UI | S3 knowledge-bucket → 自動 Ingestion | 家族 | Step 6, Issue #15 |
| **[3]** | 不足領域分析 | KBミスヒット質問のログ | てつてつへの可視化レポート | システム | Step 7 一部, Issue #16 |

### 現状の Open Issue 一覧 (2026-05-07 時点、優先度ラベル付与済み)

#### 機能・運用系 (既存)

| Priority | Issue | タイトル | 種別 | 紐づく Step |
|---|---|---|---|---|
| **P1** | **#16** | KB根拠なし質問のフィードバックループ (Phase 2 以降) | 実装、#17 ベースラインの cp=0 質問群を inputs に活用可 | Step 7 (経路 [3]) |
| **P1** | **#21** | ユーザー不満の直接記録機能 (👎+自由記述) | 実装 | Step 7 |
| **P2** | **#15** | ナレッジ投稿の品質ガード設計 | 設計議論 | Step 6 |
| **P2** | **#20** | 既存KB 14本に sidecar metadata 付与 | 実装 | Step 7 |
| **P3** | **#13** | 回答生成モデル動的切替機能 (Haiku/Sonnet) | 実装、軽い | 横断 (#22 とは別物、動的切替) |
| **P3** | **#19** | 画像入力対応 (症状写真 → Vision LLM → KB) | 実装 | Phase 2 |

#### コードレビュー由来 (2026-05-07 起票、awsiac MCP の cdk_best_practices に基づく足固め)

| Priority | Issue | タイトル | 観点 | 関連ファイル |
|---|---|---|---|---|
| ~~P1~~ | ~~#28~~ | ~~Bedrock IAM 権限を最小権限に絞り、3 ロールで共通ヘルパー化~~ — **2026-05-23 完了** (`feature/issue-28-bedrock-iam-least-privilege`、knowledge.md 2026-05-23 参照) | セキュリティ | `backend.ts`, `infra/iam.ts`, `infra/evaluation.ts` |
| ~~P1~~ | ~~#29~~ | ~~DynamoDB `expiresAt` をバックエンドで強制計算~~ — **2026-05-23 「起票時前提解消済み」でクローズ** (PR #45 アーカイブ刷新でフロント書き込み 3 箇所が撤去済み。残るゴミ箱送り 1 箇所は `web/app/lib/ttl.ts` に集約済みで家族運用では実害なし。knowledge.md 2026-05-23 参照) | 信頼性 | `web/app/lib/ttl.ts`, `web/app/page.tsx` |
| **P2** | **#30** | Lambda リソース・CloudWatch Logs 保持の実測ベース最適化 | コスト・信頼性・観測性 | `functions/*/resource.ts`, `infra/evaluation.ts` |
| ~~P2~~ | ~~#31~~ | ~~設定値の環境変数化~~ — **2026-05-23 完了** (PR #60 `feature/issue-31-env-cleanup`、knowledge.md 2026-05-23 参照)。`_shared/env.ts` 新規 + chat/summarize handler を init-time throw に統一 + EMBEDDING_MODEL_ID env 化 (KB は CFn no-op 確認)。**派生**: 0.62〜0.69 帯の語彙ギャップで取りこぼす質問への根本対応として Nova Pro による同義語クエリ拡張を `feature/query-expansion-issue-31` で別 PR 化予定 (2026-05-10) は残課題 | 保守性 | — |
| **P2** | **#32** | Cognito sign-up 無効化を CDK で明示化 | セキュリティ | `auth/resource.ts`, `backend.ts` |
| **P2** | **#33** | Bedrock KB / DataSource の removalPolicy 明示と再作成 SOP 整備 + **Amplify Hosting 反映フロー Run Book** + **hosting.ts コメント補強** (2026-05-23 #34 から統合) | 信頼性 | `infra/knowledge-base.ts`, `amplify/infra/hosting.ts`, 新規 `docs/operations.md` |
| ~~P3~~ | ~~#34~~ | ~~Amplify Hosting 環境変数展開フローを npm script に集約~~ — **2026-05-23 「主要部分実装済み」でクローズ** (npm script 集約は PR #49 で実装済み、`npm run sandbox` + `scripts/sync-outputs-env.mjs` が等価機能。残作業の Run Book + CDK コメント補強は #33 に統合。knowledge.md 2026-05-23 参照) | 保守性 | — |

着手順の推奨: ~~#28~~ (2026-05-23 完了) → ~~#29~~ (2026-05-23 クローズ、前提解消済み) → ~~#34~~ (2026-05-23 クローズ、PR #49 で実装済み + 残作業は #33 統合) → ~~#31~~ (2026-05-23 完了、PR #60) → #32 → #33 → #30 (実測値が必要なので 1〜2 週間データを貯めてから)。

直近 close 済 (履歴): **(2026-05-08)** Nova Pro 切替 + Issue #31 部分対応 (`feature/nova-pro-migration` で PR 化予定、目視 QA OK、Ragas Run `run_20260508_152801` faith 0.65 / ar 0.39 / cp 0.64 / cr 0.20 ※judge も Nova Pro のため self-eval bias 大、参考値扱い) / **#22** Sonnet 4.6 Global 切替 (PR #23, 2026-05-05) / **#18** systemPrompt リスク階層化 (PR #24, 2026-05-05) / **#17** Ragas 評価パイプライン (PR 作成中, 2026-05-05、ベースライン faith 0.45 / ar 0.69 / cp 0.13 / cr 0.22)

### 命名ルール (2026-05-05 合意)

- **B-x 命名は今後新規発行しない** (B-2 欠番、付け方が時系列でないため混乱の元)
- 公式名は **Step 番号 (Step 6 など)** または **タスク名** で呼ぶ
- 既存 PR の B-x はそのまま履歴として残す (改名はノイズ)
- Issue は番号で参照 (#13, #15, #16, #17)

### 直近の追加作業 (Step 5 完了後に main で実施済み)

- PR #11 `feature/amplify-hosting`: Amplify Hosting CDK 化 (マージ済み、当時 B-5 表記)
- PR #12 `feature/concierge-rebrand`: アプリ名 → **Cocco RAG**、サイドバーに「コケ先輩」キャラ表示、systemPrompt に語尾「コケ」指示を追加 (マージ済み)
- PR #14 `feature/mobile-responsive`: 左ペインを md (768px) 未満でハンバーガーメニュー化、スマホ閲覧対応 (マージ済み)

### 現在の構成スナップショット

- **AWSアカウント**: `~/.secrets/chicken-knowledge-rag.env` 参照、リージョン ap-northeast-1
- **デプロイ済み Stack**: `amplify-chickenknowledgerag-tetutetu-sandbox-8023efca66`
- **本番URL**: `~/.secrets/chicken-knowledge-rag.env` の `AMPLIFY_HOSTING_URL` 参照（feature/amplify-hosting ブランチ → 動作確認完了、main マージ後は main URL に切替）
- **配備リソース**:
  - Bedrock KB ID: 19S0LSZVPF (14本取込済み: 公的マニュアル7本 + 鳥獣・卵食品安全7本)
  - DataSource ID: AFSV7SCBAD
  - **AppSync GraphQL**: `amplify_outputs.json` の `data.url`（Cognito User Pool 認証必須）
    - `chat(question, historyJson, summary)` クエリ: Bedrock Retrieve + Converse、KB必須化、履歴・要約対応
    - `summarize(existingSummary, messagesJson)` mutation: Nova Pro (APAC) で会話履歴を統合要約
    - `Conversation` モデル: title / summary / summarizedCount / expiresAt + messages (hasMany)、`allow.owner()` で所有者ガード
    - `Message` モデル: conversationId / role / content / citations(JSON) / hasKbResults / expiresAt、`allow.owner()`
  - **DynamoDB TTL**: Conversation / Message 両方に `expiresAt` 属性 (90日後の Unix epoch seconds) で TTL 有効化
  - **chat Lambda**: `amplify_outputs.json` の `custom.chatFunctionName` (TypeScript、Retrieve + Converse 統一構成)
  - **summarize Lambda**: `amplify_outputs.json` の `custom.summarizeFunctionName` (Nova Pro APAC で要約)
  - **Cognito User Pool**: `amplify_outputs.json` の `auth.user_pool_id`（User1/User2 登録済み、CONFIRMED + 永続パスワード）
  - **Amplify Hosting App**: `amplify_outputs.json` の `custom.amplifyHostingAppId` / `amplifyHostingDefaultDomain`（CDK で IaC 化、GitHub PAT は Secrets Manager の `chicken-rag/github-token` を参照）
  - フロント: `web/` (Next.js 16 + Authenticator + サイドバーマルチスレッドUI + 要約自動呼出、`output: 'export'` で静的サイト化)

### 主要コマンド

- ローカル起動: `cd web && npm run dev` → http://localhost:3000、サインインは User1/User2 のメアドと `~/.secrets/chicken-knowledge-rag.env` の `USER{1,2}_PASSWORD`
- **再デプロイ (推奨)**: `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox` — sandbox 後に `AMPLIFY_OUTPUTS_GZ_B64` を自動同期する。次回 sandbox 時に Amplify Hosting に反映される。
- **本番即時反映**: `source ~/.secrets/chicken-knowledge-rag.env && npm run sandbox:full` — sandbox を 2 回回して env 更新 → Hosting への即時反映までを一括実行 (約 4 分)。スキーマ変更を本番に即時反映したいときに使う。
- **生コマンドでの再デプロイ (非推奨、env 同期忘れ事故あり)**: `npx ampx sandbox --once --outputs-out-dir web` 単独。env 同期を忘れると本番が世代ズレで壊れる (2026-05-16 事故、knowledge.md 参照)。
- 単体テスト: `npm test` (フロント `web/`) と `npm test` (root、Lambda) を別々に実行
- E2E テスト: `cd web && source ~/.secrets/chicken-knowledge-rag.env && npm run test:e2e`
- ローカル静的ビルド検証: `cd web && rm -rf .next out && npm run build && npx serve out -p 3000`
- 全削除: `npx ampx sandbox delete` または CFn console で Stack 削除（**注意: Sandbox を本番として運用しているため削除禁止**）

### 既知の制約 (重要)

- IAM description は ASCII + Latin-1 のみ
- env ファイルは `export` 必須 (子プロセス用)
- MAFFサイトの `attach/pdf/` 配下は Bot ブロックで自動取得不可
- **Next.js 16 multiple lockfile 警告は機能影響なし**だが Amplify Hosting ビルド時に workspace root が誤判定されるため `web/next.config.ts` の `turbopack.root` で web/ に固定済み
- **S3 Vectors は閾値なしで top-K を必ず返す** → Lambda 側でコサイン類似度 0.7 を閾値に振り分け (knowledge.md 2026-05-04 参照)
- AI Kit の `defineConversationHandlerFunction` は公式ドキュメントが薄く、B-3 後半でも採用見送り。代わりに `a.model()` + フロント直接 CRUD (knowledge.md 2026-05-04 参照)
- **AppSync の `AWSJSON` (= `a.json()` フィールド) は入出力共に JSON 文字列**。object をそのまま渡すと create が静かに失敗する。必ず `JSON.stringify` で渡し、Amplify Data の create/update 戻り値の `errors` は必ずキャプチャすること
- **`ampx sandbox` の synth は実行開始時のソースで固定**。走行中の編集は次回 synth まで反映されない。スキーマ変更を伴う編集は実行開始前に終わらせるか、再デプロイで反映する
- **Amplify Hosting 環境変数は 1 個 5500 文字上限** → `amplify_outputs.json` を gzip+base64 で渡す必要あり (`AMPLIFY_OUTPUTS_GZ_B64`)
- **Amplify Hosting + monorepo (web/) の場合、`amplify_outputs.json` は web/ 配下に置く必要あり** (Turbopack workspace root + import 解決の制約)
- **Sandbox を本番として共有運用**しているため `npx ampx sandbox delete` は禁止 (削除すると Hosting も止まる)
- **`next build` の TypeScript チェックは無効化**済み (`typescript.ignoreBuildErrors: true`)。型チェックは `ampx sandbox` の "Running type checks..." で代替

## 凡例

- [ ] 未着手
- [x] 完了
- [~] 進行中

## スコープ対応表

- **A: 最小確認版** = Step 0〜3（AWS Console で動作確認まで）— 5時間枠の必達ライン (完了)
- **B: API疎通版** = A + Step 4 の一部（Lambda + API Gateway で疎通）(完了)
- **C: フロント簡易版** = B + Step 5 の一部（Next.js 1スレッド限定UI）(完了)
- **Phase 1.5** = Step 4後半 + Step 5後半 + Step 6（認証・マルチスレッド・家族ナレッジ追加）— Step 5 まで完了、Step 6 は再定義中
- **運用** = Step 7〜8

## Step 0: プロジェクト初期化（スコープA）

- [x] フォルダ作成・命名（chicken-knowledge-rag）
- [x] docs/ 配下4ファイル作成（plan.md / spec.md / todo.md / knowledge.md）
- [x] プロジェクト用 CLAUDE.md 作成
- [x] てつてつとplan.mdの方針確認（A→B→C順・予算 $30 ・ハードストップ込み）
- [x] AWS CLI 認証確認（識別情報は `~/.secrets/chicken-knowledge-rag.env`）
- [x] `~/.secrets/chicken-knowledge-rag.env` 作成（権限600）
- [x] `.gitignore` 設定（`.env` / `node_modules` / `.amplify` / `*.pem` 等）
- [x] Gitリポジトリ初期化（`git init -b main`）
- [x] Initial commit（chore）
- [x] GitHubリポジトリ作成（パブリック）: `https://github.com/tetutetu214/chicken-knowledge-rag`
- [x] Secret Scanning + Push Protection 有効化
- [x] AWSアカウントID漏洩チェック（OK）

## Step 0.5: Amplify Gen2 プロジェクト初期化（スコープA）

- [x] `feature/aws-infrastructure-setup` ブランチ作成
- [x] Node.js / npm バージョン確認（v20.20.1 / 10.8.2）
- [x] `npm create amplify@latest -y` で雛形生成（約8分）
- [x] amplify/backend.ts, auth/resource.ts, data/resource.ts 作成
- [x] aws-cdk-lib 2.234.1 で S3 Vectors / Bedrock KB CDK サポート確認
- [x] .gitignore マージ（Amplifyが amplify_outputs / amplifyconfiguration を追記）

## Step 1: AWS環境準備（スコープA）

- [x] ap-northeast-1 リージョンで作業することを確認
- [x] CDK Bootstrap 実行（孤児バケット削除込み）
- [x] AWS Budgets 作成: 月額 $30 上限（ACTUAL 50%/80%/100% メールアラート）
- [x] AWS Budgets Actions 設定: 100%超過時に Bedrock呼び出しDenyポリシーを自動アタッチ（STANDBY 状態で待機中）
- [x] ハードストップ用 IAMポリシー作成: `chicken-rag-bedrock-deny`
- [x] IAMロール作成: `chicken-rag-bedrock-kb-role` (Bedrock KB サービスロール)
- [x] IAMロール作成: `chicken-rag-lambda-role` (Lambda実行ロール、ハードストップ対象)
- [x] IAMロール作成: `chicken-rag-budget-action-role` (Budgets Actions 実行ロール)
- [x] Amplify Sandbox デプロイ成功 (213秒、90リソース作成)
- [x] S3バケット作成: `chicken-rag-docs-{accountId}-{region}` (KBサービスロールに読取権限付与)
- [x] S3バケット作成: `chicken-rag-knowledge-{accountId}-{region}` (Phase 1.5で利用)
- [x] S3バケット作成: `chicken-rag-image-{accountId}-{region}` (Phase 2で利用)
- [x] 全バケットの暗号化(AES256)・パブリックアクセスブロック・enforceSSL・バージョニング確認
- [ ] Bedrock コンソールで Claude Sonnet 4.5 / Haiku 4.5 / Titan V2 のモデルアクセス有効化（てつてつ作業）

## Step 2: Bedrock KB作成（スコープA）

CDK拡張 (`amplify/infra/knowledge-base.ts`) で全リソース定義。

- [x] S3 Vectors VectorBucket 作成 (`chicken-rag-vectors-{accountId}-{region}`)
- [x] S3 Vectors Index 作成 (1024d / cosine / float32 / `chicken-rag-index`)
- [x] Embeddingモデル: Titan Text Embeddings V2（amazon.titan-embed-text-v2:0）
- [x] Bedrock KB 作成 (S3_VECTORS バックエンド、Status: ACTIVE)
- [x] Hierarchical chunking設定（parent 1500 / child 300 / overlap 60）
- [x] データソース作成 (docsBucket、Status: AVAILABLE)
- [x] KB Invoke Policy (`chicken-rag-kb-invoke`) を ManagedPolicy として独立化（race condition対策）
- [x] sandbox再デプロイ成功 (差分82秒)

## Step 3: 初期ドキュメント取込（スコープA）

- [x] 飼養衛生管理基準（鶏）ダウンロード・S3アップロード（798KB、`飼養衛生管理基準_鶏.pdf`）
- [x] HPAI防疫指針 本体 ダウンロード・S3アップロード（1.5MB、index-75）
- [x] HPAI防疫指針 資料1 ダウンロード・S3アップロード（1.1MB、index-76）
- [x] HPAI防疫指針 資料2 ダウンロード・S3アップロード（655KB、index-77）
- [x] AW指針（採卵鶏編）ダウンロード・S3アップロード（400KB、令和5年7月版）
- [x] 鶏卵生産衛生管理ハンドブック ダウンロード・S3アップロード（1.3MB）
- [x] 採卵鶏HACCP衛生管理マニュアル ダウンロード・S3アップロード（284KB / 10ページ）
- [x] StartIngestionJob 実行（KB ID: 19S0LSZVPF / DS ID: AFSV7SCBAD）
- [x] Ingestion COMPLETE（7/7 documents indexed、追加分は約1分）
- [x] CLI `retrieve-and-generate` で引用付き回答が返ることを確認 ← **✅ スコープA 完了条件達成**
  - 質問1: "採卵鶏の衛生管理で重要なポイントを教えて" → ハンドブック p4/p9 引用
  - 質問2: "鳥インフルエンザの感染拡大防止のために最低限すべきことを教えて" → HPAI防疫指針本体/資料2 p25 引用
  - モデル: `jp.anthropic.claude-haiku-4-5-20251001-v1:0` (Inference Profile)

### 2026-05-03 追加取込（v2.0 ペット飼育前提カバレッジ拡張）

- [x] サルモネラ食中毒予防_厚労省広報.pdf（617KB、家庭での卵食品安全）
- [x] 鶏卵選別包装施設HACCP手引書_厚労省.pdf（1.3MB、on egg / in egg 汚染経路）
- [x] 野生鳥獣被害防止マニュアル_中型獣類編_令和5年.pdf（10.5MB、農水省、アライグマ・ハクビシン・タヌキ・アナグマ）
- [x] 鳥獣保護管理基本指針_環境省.pdf（248KB、鳥獣保護管理法の基本指針）
- [x] 神奈川県_アライグマハクビシン対策パンフ.pdf（8KB、県レベル対策）
- [x] 神奈川県_第4次アライグマ防除実施計画.pdf（4.7MB、市町村届出ベース捕獲の根拠）
- [x] 神奈川県_食痕被害痕の見分け方.pdf（147KB、加害動物の特定）
- [x] StartIngestionJob 実行（JobId: V4I8KBQHRT、新規7件のみ index 化、約1分でCOMPLETE）
- [x] CLI `retrieve-and-generate` で引用付き回答を確認（KBは合計14ドキュメント体制）
  - 質問1: "ハクビシンが鶏小屋の周りで目撃された場合の対処" → ⚠ 既存ハンドブックのみ引用、中型獣類編が引かれず（Phase 1.5の retrieval チューニング課題として記録）
  - 質問2: "鶏卵の家庭保存とサルモネラ予防" → 新規 鶏卵HACCP手引書 + 既存ハンドブック引用 ✅
  - 質問3: "所在自治体でアライグマを捕獲する手続き" → 神奈川県第4次アライグマ防除実施計画から3引用 ✅

## Step 4: 会話バックエンド（スコープB / Phase 1.5）

- [x] Lambda (Python 3.12) + Function URL で `retrieve_and_generate` を呼び出す最小実装（スコープB）
- [x] CDK拡張 (`amplify/infra/api.ts`) で Lambda + ManagedPolicy + Function URL 一括定義
- [x] `lambda/conversation_handler/index.py` で Bedrock 呼び出し + 引用元抽出
- [x] LambdaInvokePolicy: Retrieve / RetrieveAndGenerate / InvokeModel / GetInferenceProfile / UseInferenceProfile
- [x] curl で API疎通確認 ← **✅ スコープB 完了条件達成**
  - URL: Lambda Function URL（NONE 認証、CORS 許可）
  - 質問→引用付き回答（鶏卵生産衛生管理ハンドブック p13 引用）
- [x] Amplify Gen2 プロジェクト初期化（`npm create amplify`）（Step 0.5 で完了済み）
- [x] `amplify/data/resource.ts` に `a.query('chat')` ルート定義（Phase 1.5 B-3 前半、2026-05-04。当初 `a.conversation()` 予定だったが案Yに変更、knowledge.md 参照）
- [x] Conversation Handler を AppSync 経由に切替（Phase 1.5 B-3 前半、2026-05-04。TypeScript Lambda + Direct Lambda Resolver）
- [x] DynamoDB スキーマ確認（Conversation/Message を `a.model()` で自前定義、TTL 90日を CDK escape hatch で設定、id は Amplify 標準採番）（Phase 1.5 B-3 後半、2026-05-04）
- [x] summarize-handler Lambda 新規作成（Haiku 4.5 で履歴を統合要約）（Phase 1.5 B-3 後半、2026-05-04）
- [x] chat-handler を Retrieve + Converse 自前構成に統一（履歴 + summary 対応、citations は Retrieve top5 から重複除去で構築）（Phase 1.5 B-3 後半、2026-05-04）
- [ ] EventBridge ルール作成（S3 ObjectCreated → StartIngestionJob）（Phase 1.5 B-4）

## Step 5: フロントエンド（スコープC / Phase 1.5）

- [x] Next.js 16 + Tailwind v4 + React 19 セットアップ（`web/` サブディレクトリ）
- [x] 1スレッド限定の超簡易チャット画面（認証なし、Lambda Function URL を fetch）
- [x] 引用元表示コンポーネント（ファイル名 + ページ番号）
- [x] ダークモード対応（OS追従）
- [x] Cmd/Ctrl+Enter 送信ショートカット
- [x] Playwright + Chromium で E2E smoke test 3本（初期表示 / KB範囲内回答 / KB範囲外）
- [x] 全テストpass（実ブラウザでの動作確認も完了）← **✅ スコープC 完了条件達成**
- [x] `<Authenticator>` で Cognito 認証（Phase 1.5 B-1、2026-05-03）
- [x] Cognito User Pool に2名のユーザー登録（admin-create-user で User1/User2 作成、CONFIRMED + 永続パスワード設定済み）
- [x] Authenticator UI 日本語化（I18n.putVocabulariesForLanguage）+ サインアップ画面非表示（hideSignUp）
- [x] Playwright smoke test を認証ガード前提に書き換え（既存3本は skip、新規「サインイン画面表示」1本追加 → 1 passed / 3 skipped）
- [x] Lambda Function URL の認証強化（AppSync 経由 + Cognito User Pool）（Phase 1.5 B-3 前半、2026-05-04 完了。`generateClient<Schema>().queries.chat()` 経由で全リクエストが認証必須に）
- [x] KBヒット有無による回答振り分け実装（cosine 類似度 >= 0.7 を閾値、未満は「⚠ 参考資料にはありません」+ LLM 一般知識回答、2026-05-04）
- [x] マルチスレッドチャットUI（`a.model('Conversation', 'Message')` + `allow.owner()` 採用、フロントが直接 CRUD、累積要約方式で履歴圧縮）（Phase 1.5 B-3 後半、2026-05-04）
- [x] スレッド一覧サイドバー実装（左サイドバー固定280px、選択ハイライト、hover で削除ボタン表示）（Phase 1.5 B-3 後半、2026-05-04）
- [x] 累積要約による長期履歴圧縮（summarizedCount で進捗管理、新10件分追加要約、コスト約 $0.0001/回）（Phase 1.5 B-3 後半、2026-05-04）
- [x] Amplify Hosting にデプロイ（Phase 1.5 B-5、2026-05-04 完了）
  - Next.js 16 で `output: 'export'` を採用し静的サイト化（SSR Compute 課金回避）
  - `amplify/infra/hosting.ts` で Amplify::App + Amplify::Branch を CDK 化（手作業マネコン排除、再現性確保）
  - GitHub PAT は AWS Secrets Manager (`chicken-rag/github-token`) から CDK が `SecretValue.secretsManager()` で参照
  - `amplify_outputs.json` は gzip+base64 (`AMPLIFY_OUTPUTS_GZ_B64`) として CDK 経由で Amplify Hosting に渡す（5500 文字上限のため gzip 必須）
  - `web/next.config.ts` で `turbopack.root` 固定 + `typescript.ignoreBuildErrors` で Amplify Hosting ビルド対応
  - 本番 URL: `~/.secrets/chicken-knowledge-rag.env` の `AMPLIFY_HOSTING_URL` 参照
- [x] アプリ名を **Cocco RAG** にリブランド + 「コケ先輩」キャラ実装（PR #12、2026-05-04）
  - `web/app/layout.tsx` の title / description 変更（「にわとりとの暮らしを支援するRAGエージェント」）
  - `web/app/page.tsx` のロゴを「🐓 Cocco RAG」、サブテキスト「にわとり飼育アシスタント　コケ先輩」
  - `amplify/functions/chat-handler/handler.ts` の systemPrompt に**コケ先輩キャラ設定 + 全文の語尾「コケ」指示**を追加（警告メッセージ含む全文に適用）
- [x] スマホ対応 — 左ペインをハンバーガーメニュー化（PR #14、2026-05-04）
  - md (768px) 以上で常時表示、未満で fixed + transform でスライド出し入れ
  - 左上にハンバーガーボタン (☰)、背景オーバーレイ (z-30, bg-black/50) でタップ閉じ
  - スレッド選択・新規会話ボタンタップで自動でサイドバーを閉じる UX

### パスキー認証 Phase 3 (2026-05-18 起案、PR3 `feature/passkey-signin-screen` 予定)

詳細方針は `plan.md` の「Phase 3 の実装方針」参照。

- [ ] `web/app/SignInScreen.tsx` 新規作成 (メアド入力 + 「🔑 パスキーでサインイン」ボタン + 「パスワードでサインイン」フォールバックリンク → 同画面でパスワードフォーム展開)
- [ ] `web/app/AuthenticatorWrapper.tsx` 改修: `<Authenticator hideSignUp>` を `<Authenticator.Provider>` + `useAuthenticator((ctx)=>[ctx.route])` で route 分岐 (`authenticated` 以外なら `<SignInScreen>`、authenticated なら children)
- [ ] `web/app/ConfigureAmplifyClientSide.tsx` の i18n から旧 Authenticator 文言 (`Sign In with Password` / `Sign In with Passkey` / `Sign In` / `Sign in` / `Sign in to your account` / `Email` / `Password` / `Forgot your password?` 等で自前画面不使用になるもの) を整理。`Add passkey` `Passkey` `WebAuthn is not supported on this device` 等の PasskeyManagementModal 用は残す
- [ ] パスキーサインイン: `signIn({ username: email, options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' } })` を呼び、`nextStep.signInStep === 'DONE'` を確認
- [ ] エラーハンドリング: WebAuthn 非対応 / `UserCancelledException` / Cognito 例外を UI で吸収し「パスワードでサインイン」へ誘導
- [ ] パスワード fallback: 同画面で `signIn({ username, password, options: { authFlowType: 'USER_AUTH' } })` を呼ぶ (preferredChallenge 指定なし)
- [ ] Vitest: `SignInScreen` のレンダリング + メアド入力 + パスキーボタン押下時に `signIn` が指定引数で呼ばれること (`aws-amplify/auth` は `vi.mock`)
- [ ] Playwright `web/tests/auth.setup.ts` 改修: 自前ログイン画面の操作に追従 (パスワード fallback リンクをクリックしてからメアド・パスワード入力)
- [ ] Playwright `web/tests/passkey.spec.ts` 既存 (サイドバー → モーダル開閉) は無修正で pass することを確認
- [ ] PR 作成前に Vitest / E2E 全 pass、てつてつのレビュー + 実機目視 (PC Chrome + スマホ Safari でパスキー初回ログイン体験)
- [ ] 本番反映後、家族への新ログイン画面の周知 (LINE 等)

## Step 6: 家族ナレッジ追加機能（Phase 1.5、KB拡充の経路 [2]）

**2026-05-05 再定義**: 当初の「自由記述 Markdown 投稿フォーム」単独路線は廃案。会話駆動抽出 (KBあり+ユーザー追加情報パターン) を入口に、起案 → 編集 → 承認 → 保存のフローに組み替える。経緯は Issue #15 と knowledge.md 2026-05-05 を参照。

### 設計議論 (Issue #15 で進行中)

- [ ] 会話駆動抽出の方式確定 ((2) KBあり+ユーザー追加情報パターンに絞る方針が暫定合意)
- [ ] 抽出ターンの判定アルゴリズム決定 (LLM プロンプト方針)
- [ ] 必須メタデータ確定 (source_type / category / 確度自己申告など)
- [ ] 投稿可能カテゴリの確定 (疾病・薬剤・卵食品安全を除外する方針)
- [ ] systemPrompt 追記文言の起案 (field_knowledge の扱い)

### 実装タスク (設計確定後)

- [ ] 起案用 Lambda 追加 (会話履歴 + KB結果 → Markdown 案生成)
- [ ] 承認 UI (Next.js、起案 → 編集 → 承認)
- [ ] 保存 Lambda (S3 knowledge-bucket + メタデータ sidecar)
- [ ] EventBridge → StartIngestionJob 自動実行ルール

### 廃案 (やらないこと)

- 自由記述 Markdown エディタ単独路線 (短文汚染リスクが構造的に防げない)
- 投稿前 RAG プレビュー → Phase 3 まで持ち越し

## Step 7: 精度チューニング（運用フェーズ）

すべて Issue 切り出し済み。

- [x] **Issue #17** Ragas 評価パイプライン構築 — 2026-05-05 ベースライン取得完了。Run ID `run_20260505_151700` (faithfulness 0.45 / answer_relevancy 0.69 / context_precision 0.13 / context_recall 0.22)。Python 3.12 + Container Image / chat-handler 直接 invoke (案 C) / 独立 nested stack 構成。月次 EventBridge Scheduler 稼働開始。詳細は knowledge.md 参照。PR は `feature/ragas-evaluation-pipeline`
- [x] **Issue #16 Phase 1** KB 不足領域分析の収集基盤（PR #27、`feature/kb-miss-logging`、KB拡充の経路 [3] の入口、2026-05-06 完了）
  - [x] `amplify/data/resource.ts` の `Message` モデルに `topScore: a.float()` を追加（保存先）
  - [x] `amplify/data/resource.ts` の `ChatResponse` カスタム型に `topScore: a.float()` を追加（戻り値）
  - [x] `amplify/functions/chat-handler/handler.ts` で算出済みの `topScore` を `ChatResponse` に乗せて返す
  - [x] `web/app/page.tsx` の assistant メッセージ保存時に `topScore` を保存。`MessageRow` 型と `loadMessages` も追従
  - [x] `npx ampx sandbox --once --outputs-out-dir web` で再デプロイ (UPDATE_COMPLETE 123秒)
  - [x] DynamoDB の `Message` テーブルに `topScore` が float で保存されていることを CLI で確認 (2026-05-06: `topScore=0.7332` を1件捕捉、knowledge.md 参照。閾値 0.7 の偽陽性議論は Phase 2 で再検討)
  - [x] スマホ閲覧時の視認性改善 — メッセージ表示をラベル上・本文下の縦並びにレイアウト変更 (PR #27 同梱)
  - [x] PR 作成 → main にマージ
- [x] **Issue #16 Phase 1 バグ修正** topScore が selection set から脱落して NULL 保存される問題を解消 (`fix/topscore-selection-set`、2026-05-16)
  - [x] Phase 2 着手前のデータ蓄積調査で topScore=NULL 17件、float 値 1件 (Phase 1 マージ直後の 0.7332 のみ) を発見
  - [x] 原因特定: Amplify Data v2 の `a.customType` optional フィールドが selection set から脱落するキャッシュ問題 (knowledge.md 2026-05-16 参照)
  - [x] `amplify/data/resource.ts` の `ChatResponse.topScore` を `a.float().required()` に変更 (`Message.topScore` は既存 NULL レコード互換のため `a.float()` のまま)
  - [x] `web/node_modules` / `web/amplify_outputs.json` / `web/.next` / `.amplify/` を全削除 → `npm install` → `npx ampx sandbox --once --outputs-out-dir web` (UPDATE_COMPLETE 155秒)
  - [x] ローカル `npm run dev` 起動 → 実機テスト 1 件 → DDB に `topScore=0.8319521248340607` 保存を確認
  - [x] 既存 NULL レコード 22件 (内訳: user メッセージ 13 件は仕様上正しい、assistant メッセージ 9 件が脱落分) は放置決定。Phase 2 でフロント側 `topScore != null` フィルタで除外する設計のため DDB 操作なし (2026-05-16 確認、knowledge.md 2026-05-16 決定事項参照)
  - [x] PR 作成 → main マージ → Amplify Hosting 自動ビルド → 本番でも 1 件投入して再検証 (2026-05-16 完了)
- [x] **Issue #16 Phase 2** KB 不足領域 BI 画面（`/insights`）— 2026-05-16 完了 (PR #50)
  - 詳細方針: `plan.md` 「Issue #16 Phase 2 — `/insights` BI 画面の実装方針」
  - ブランチ: `feature/insights-dashboard` (マージ済み、ローカル削除済み)
  - 採用: recharts (SVG/React コンポーネント方式、家族のみ × 数百件規模で SVG の重さは非問題)、CSV は自前生成 (列 5 で依存追加不要)
  - 集計ロジックは `web/lib/insights.ts` に純関数として切り出し、Vitest で単体テスト + Playwright E2E (`tests/insights.spec.ts`)
  - [x] feature ブランチ作成 + recharts インストール
  - [x] `web/lib/insights.ts` (`pairUserAssistant` / `monthlyBuckets` / `topScoreHistogram` / `toCsv` / `summarize`)
  - [x] `web/app/insights/page.tsx` (サマリーカード 4 枚 + 月次棒グラフ + topScore ヒストグラム + 一覧 + CSV ボタン)
  - [x] サイドバー (`web/app/page.tsx`) に `/insights` 導線追加
  - [x] 単体テスト (`web/lib/insights.test.ts`、17 件追加 → 合計 45 件 pass)
  - [x] E2E テスト (`web/tests/insights.spec.ts`、3 件 pass、`data-insights-loaded` マーカー方式)
  - [x] `npm run build` 成功 (`/insights` が static prerender に乗ることを確認)
  - [x] PR #50 作成 → main マージ (2026-05-16 23:46) → Amplify Hosting ビルド #34 SUCCEED (23:47) → 本番 `/insights` HTTP 200 疎通確認済み
  - [x] todo.md / knowledge.md 結果反映 (この更新)
  - [ ] **残**: てつてつ担当のブラウザ目視 smoke (グラフ描画・CSV ダウンロードの実機確認)
  - **既知の警告**: recharts ResponsiveContainer の `width(-1) height(-1)` 警告が初期描画時にコンソールに出る。recharts v3 の親要素サイズ未確定タイミングでの既知挙動で機能影響なし。気になるようなら後続 PR で対処
- [ ] **Issue #16 Phase 3** LLM 補助による棚卸サイクル — Phase 2 完了後に判断
- [x] **Issue #18** systemPrompt 改善 (リスク階層 L1/L2/L3 で専門家相談を出し分け、回答長さ800字、引用フォーマット `[S1]` + `## 出典`、PR #24 で完了、2026-05-05)
- [x] **ペルソナ「コケ語尾」緩和** (家族フィードバック「毎回コケつけすぎて読みにくい」対応。全文必須 → 全体で1〜2回・自然な位置のみに変更、定型文4箇所のコケも撤去。PR #38、2026-05-09)
- [x] **persona 指示の精緻化と KB 閾値 0.7→0.75** (動作確認で「コケが単独行に出る」「無関連質問が閾値ギリギリで誤ヒット」を発見し追加対応。fix/koke-natural-and-threshold-075、2026-05-09)
- [x] **KB 閾値 0.75→0.7 戻し** (家族利用ログで「鶏の正式名称」topScore 0.734 / 「首の骨の数」topScore 0.622 が KB 未ヒット扱いになる事象を確認。0.734 帯は閾値戻しで救済、0.622 帯は語彙ギャップ問題として別軸対策に持ち越し。fix/score-threshold-revert-070、2026-05-09 PM)
- [x] **ペルソナ「コケ語尾」必須化** (家族から「最近コケが入っていない」指摘。PR #38 で「1〜2回だけ」と上限のみ指定にした結果、Nova Pro がゼロ回解釈する事象が常態化。「必ず1回、最大2回」と下限を明示し、「一度も入れずに終えてはいけない」明示禁止行を追加。fix/koke-required、PR #46 マージ済み、2026-05-11)
- [x] **ペルソナ「コケ語尾」を回答本文の最後の1文に位置固定化** (PR #46 で「必ず1回」と下限明示後も家族から「全然出てこない」「会話ごとのまとまりで付けてほしい」フィードバック。Nova Pro が下限指示も無視する事象が再発したため、回数制約から位置制約に切替。回答本文の最後の1文の文末を「〜コケ。」で必ず締める + もう1か所だけ任意。専門家相談文・出典・KB ヒットなし時定型文には絶対付けない明示も追加。`fix/koke-last-sentence` PR #52 マージ済み、2026-05-17。本番動作の家族目視は実利用フィードバック待ち)
- [x] **アーカイブを「90日後自動削除のゴミ箱」モデルに変更** (2026-05-10、`feature/archive-revamp`、PR #45 マージ済み、2026-05-11)
  - [x] `web/app/page.tsx`: `createThread()` / `send()` / `Message.create` の `expiresAt: ttlSeconds()` を撤去 (アクティブは TTL 対象外)
  - [x] `setArchived(id, true)` で Conversation + 紐付く全 Message の `expiresAt` を `now + 90日(秒)` に上書き
  - [x] `setArchived(id, false)` (復元) で `expiresAt = null` に戻す
  - [x] アーカイブ UI を折りたたみから固定ヘッダー + 常時表示に変更、各行に「あと N 日で削除」表示
  - [x] アクティブ行のアーカイブボタンタップ時に確認ダイアログ追加 (誤タップ対策)
  - [x] **UI ラベルを「アーカイブ」→「ゴミ箱」に統一** (2026-05-11、家族から「📥 のアイコンの意味が分からない」フィードバック対応。絵文字 📥 → 📦 / 🗑、ヘッダー背景を amber に、確認ダイアログ・エラー文言・aria-label もゴミ箱呼称に変更)
  - [x] PR #45 を main にマージ (2026-05-11)
- [ ] **Issue #31 RAG クエリ拡張 (`feature/query-expansion-issue-31`)** (PR1 マージ後着手、2026-05-10 起案)
  - [ ] `chat-handler.ts` に Nova Pro 同義語展開ステップ追加 (例: 「首の骨」→「首の骨, 頚椎, 頸椎」)
  - [ ] 各拡張クエリで Retrieve → スコアマージで上位5件採用
  - [ ] CloudWatch ログに「展開後クエリ」「拡張前後の topScore 比較」を出力
  - [ ] Ragas で拡張あり/なしを A/B 比較し faithfulness と context_recall の改善幅を測る
- [ ] **Issue #20** 既存KB 14本のドキュメントに sidecar metadata を付与 (source_type / category / issuer / issued_date)
- [ ] **Issue #21** ユーザー不満の直接記録機能 (メッセージ単位の👎+自由記述、#16 と並行収集)
- [x] **Issue #22** chat-handler / summarize-handler を Sonnet 4.6 Global に切替 (PR #23 で完了、2026-05-05、#18 の前提)

### 後で再検討 (今は触らない)

- ハクビシン retrieval 改善 → Issue #16 のフィードバック収集後に判断 (個別問題を当てずっぽうに直すより、まず全体像を把握する)
- Bedrock Guardrails 設定 → Issue #18 の systemPrompt 改善で頻度問題が解消するか先に検証してから判断

## Step 8: 運用・拡張

- [ ] 月次 Ragas 評価のスケジュール化 (Issue #17 の一部)
- [ ] **Issue #19** Phase 2 画像入力対応 (症状写真 → Vision LLM → KB検索)
- [ ] Phase 3 (会話型ナレッジ蓄積の本格版) 着手判断 ※Step 6 で会話事後抽出は前倒し済み

### 廃案

- 配偶者向け簡易マニュアル → 不要 (UI が分かりやすければマニュアル不要、2026-05-05 ユーザー判断)

## パスキー認証導入 (2026-05-17 起案)

設計判断と採用理由は `plan.md` の「Passkey 認証導入計画」、仕様は `spec.md` §4-2-1 を参照。

### Phase 1: バックエンド (PR1, ブランチ: `feature/passkey-backend`)

- [x] **理解度テスト 3問パス** (パスキーの本質 / Cognito 認証フロー / トレードオフ) — 2026-05-17 再テストで 3/3 合格 (鍵の所在 / フィッシング耐性=ドメイン照合 / 併用の理由=リカバリ保険 / 生体認証=ローカルロック / relyingPartyId 変更=既存パスキー無効化)
- [x] GitHub Issue 起票 (本機能用、ラベル: `enhancement` `priority/P2`) — Issue #53 起票済み
- [x] ブランチ作成: `git switch -c feature/passkey-backend`
- [x] `amplify/auth/resource.ts` に `webAuthn: { relyingPartyId, userVerification: 'required' }` 追加 (email/password は残す、relyingPartyId は `process.env.PASSKEY_RPID` 経由で `~/.secrets/` から取得)
- [x] Cognito User Pool ティア確認: 既に ESSENTIALS だったため上書き不要
- [x] LITE の場合は CDK escape hatch (`backend.auth.resources.cfnResources.cfnUserPool.userPoolTier = 'ESSENTIALS'`) で Essentials に上書き — 該当せず (既に ESSENTIALS)
- [x] `relyingPartyId` の値を本番 Amplify ドメイン (`<branch>.<appId>.amplifyapp.com`) で確定し `~/.secrets/chicken-knowledge-rag.env` の `PASSKEY_RPID` に保存
- [x] sandbox デプロイ: `npm run sandbox` で UPDATE_COMPLETE 80 秒、CFn テンプレート上で `WebAuthnRelyingPartyID` / `WebAuthnUserVerification` 両プロパティ反映確認、`AllowedFirstAuthFactors` に `WEB_AUTHN` 追加確認、Playwright E2E 9 件 pass で email/password ログイン機能の回帰なしを確認 (auth.setup を新 UI の 2 段階フローに追従させた)
- [x] PR1 作成 → main マージ (PR #54、squash マージ commit `61e79e9`、2026-05-17) → Amplify Hosting ビルド Job #40 SUCCEED 確認済み (2026-05-17 夜)

### Phase 2: フロント (PR2, ブランチ: `feature/passkey-frontend`)

- [x] ブランチ作成: `git switch -c feature/passkey-frontend`
- [x] サイドバー (`web/app/page.tsx` のサイドバー要素) 下部に「🔑 パスキー管理」ボタンを追加 (モバイル時はサイドバー自動閉じ)
- [x] モーダルコンポーネント新規作成 (`web/app/PasskeyManagementModal.tsx`、role="dialog" + aria-modal、ダークモード対応)
- [x] 「パスキーを登録」ボタン → `associateWebAuthnCredential()` 呼び出し
- [x] 「登録済み一覧」表示 → `listWebAuthnCredentials()` 呼び出し (credentialId / friendlyCredentialName / createdAt)
- [x] 「削除」ボタン → `deleteWebAuthnCredential({ credentialId })` 呼び出し
- [x] エラーハンドリング: `UserCancelledException` (ユーザーキャンセル) は静かに無視、その他 (ブラウザ非対応 / 既登録重複) は赤帯で UI 表示
- [x] Vitest 単体テスト: モーダル開閉のみ (`renderToStaticMarkup` で SSR レベル、Amplify API は `vi.mock` で完全モック)
- [x] Playwright E2E: モーダル開閉と登録ボタン表示のみ (生体認証 API は触らない)
- [x] i18n 日本語訳追加 (`ConfigureAmplifyClientSide.tsx`): `Sign In with Password` / `Sign In with Passkey` / `Passkey` / `Add passkey` / `WebAuthn is not supported on this device` を 5 件追加 (既存上書きなし)
- [x] auth.setup.ts を i18n 翻訳追加に追従 (`name: /Sign In with Password|パスワードでサインイン/i` で OR regex 両対応化)
- [x] テスト: Vitest 48 件 pass、Playwright E2E 10 件 pass (passkey.spec.ts 含む) でクロスチェック完了
- [ ] **手動目視テスト** (てつてつ担当): PC ブラウザ Chrome + スマホ Safari で実機登録 → 一覧表示 → 削除の往復確認 (本番反映済み、随時実施)
- [x] PR2 作成 → main マージ (PR #55、squash マージ commit `7adb8bca`、2026-05-18) → Amplify Hosting ビルド Job #42 SUCCEED 確認済み (2026-05-18 未明)
- [ ] 家族に「パスキー登録のお知らせ」を周知 (てつてつ担当)

### 将来 PR (家族全員パスキー登録完了後)

- [ ] `defineAuth` の `loginWith` から `email: true` を撤去、パスキーのみに切替
- [ ] Issue #32 (sign-up 無効化) と合わせ技で実装
- [ ] パスワード忘れ救済策の検討 (email OTP `otpLogin: true` を残すか、てつてつが管理画面から手動リセットするか)
