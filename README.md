# Cocco RAG

ペット鶏との暮らしを支援する RAG（Retrieval-Augmented Generation）エージェント。家族のプライベート用途で運用するシステムで、鶏の生命と卵の食品安全という二つの「命を扱う」性質から、精度担保を最優先の設計方針としている。

公的マニュアル（農林水産省の飼養衛生管理基準・HPAI 防疫指針・AW 指針など）と精選した現場ナレッジ（Markdown）を組み合わせたナレッジベースに、引用付きで回答するチャット UI を被せた構成。アプリ上では「コケ先輩」というキャラクターが回答の口調を担っている。

## なぜこのシステムか

家畜伝染病予防法上、一定規模以上の飼育は届出対象であり、ペット用途であっても防疫義務が生じる。鳥インフルエンザやサルモネラなど、判断を誤ると鶏の命や食中毒に直結する領域を扱うため、「LLM が知ったかぶりで答える」状況を構造的に避ける必要がある。

そこで本システムは次の方針を取る。

- 回答には必ず出典（ドキュメント名・該当箇所）を付ける
- 「知らない」「確認が必要」と答えることを推奨する応答スタイル
- リスク階層 L1（一般知識）／L2（軽い注意）／L3（緊急）で専門家相談アラートの強度を出し分ける（一律付与は alert fatigue を招くため廃止、Issue #18）
- 論文・参考資料は「数より精度」。ペット飼育・日本の気候条件に親和的なものを精選し、ノイズ文書による精度劣化を防ぐ

## 主な機能

- マルチスレッド型のチャット UI（スレッド一覧・新規会話・アーカイブ・復元・削除）
- Cognito 認証（家族のみ。サインアップは無効化）
- 引用元チップ表示（ファイル名 + ページ番号）と本文中の `[S1]` インライン引用
- 累積要約による長期会話履歴の圧縮（10 件単位で要約を更新）
- KB ヒット有無の自動判定（cosine 類似度しきい値で振り分け、ヒットなしは「⚠ 一般知識に基づく回答」と明示）
- スマホ対応のハンバーガーメニュー UI
- Ragas による月次精度評価（faithfulness / answer_relevancy / context_precision / context_recall）

## アーキテクチャ概要

ベクトルストアに Amazon S3 Vectors（完全従量課金）を採用し、固定費が高い OpenSearch Serverless を回避することで個人利用に見合う運用コストを目標としている。RAG オーケストレーションは Amazon Bedrock Knowledge Bases に任せ、回答生成・要約・Judge LLM はすべて Amazon Nova Pro（APAC inference profile）で統一している。当初は Claude Sonnet/Haiku を採用していたが、コスト最適化と APAC リージョン内完結のため Nova Pro へ移行した（経緯は `docs/knowledge.md` 参照）。

| 層 | 技術 |
|---|---|
| フロントエンド | Next.js 16（App Router、`output: 'export'` で静的サイト化）+ Tailwind v4 + React 19 |
| バックエンド | AWS Amplify Gen2 + AppSync（Cognito User Pool 認証必須） |
| 認証 | Amazon Cognito User Pool（家族のみ、サインアップ無効） |
| 会話履歴 | Amazon DynamoDB（`Conversation` / `Message` を `a.model()` で定義、`expiresAt` による TTL 90 日） |
| Lambda 関数 | `chat-handler` / `summarize-handler`（TypeScript）、`evaluation-handler`（Python 3.12 + Container Image） |
| 回答生成 / 要約 / Judge LLM | Amazon Nova Pro（APAC inference profile） |
| RAG オーケストレーション | Amazon Bedrock Knowledge Bases |
| ベクトルストア | Amazon S3 Vectors |
| Embedding | Titan Text Embeddings V2（1024 次元 cosine） |
| ホスティング | Amplify Hosting（CDK で IaC 化、GitHub PAT は Secrets Manager 経由） |
| 評価基盤 | Ragas v1（月次 EventBridge Scheduler で起動、独立 nested stack） |

リージョンは S3 Vectors の東京対応を前提に **ap-northeast-1（東京）** で統一している。

データソースは S3 上で `docs-bucket`（公的マニュアル・論文 PDF）、`knowledge-bucket`（Markdown 形式の現場ナレッジ）、`image-bucket`（Phase 2 用予約。症状写真や害獣被害写真）の 3 バケットに分けて管理する。新しいファイルが置かれると Bedrock KB の Ingestion ジョブが走る設計。

### 会話バックエンドの構成判断

当初は Amplify AI Kit の `a.conversation()` を採用予定だったが、公式ドキュメントが薄く挙動の制御も難しかったため採用を見送り、次の自前構成に切り替えた（経緯は `docs/knowledge.md` 2026-05-04 参照）。

- `a.model('Conversation', 'Message')` をオーナーガード付きで定義し、フロントが Amplify Data クライアント経由で直接 CRUD
- `a.query('chat')` で `chat-handler` Lambda（Bedrock Retrieve + Converse）を呼び出し
- `a.mutation('summarize')` で `summarize-handler` Lambda（Nova Pro で履歴を統合要約）を呼び出し
- 履歴は累積要約方式で長期文脈を保持（直近 10 件のみフル履歴、それ以前は要約に圧縮）

### KB ヒット判定

S3 Vectors は閾値なしで top-K を必ず返すため、`chat-handler` 側で cosine 類似度の最大値を環境変数 `SCORE_THRESHOLD` と比較して振り分けている。閾値未満は「⚠ 参考資料にはありません」とプレフィックスを付けた上で LLM の一般知識回答にフォールバックする。

しきい値は家族の利用ログを観察しながら調整しており、現状は 0.7 に設定している（0.75 まで引き上げた際に「鶏の正式名称」「首の骨の数」など語彙ギャップのある質問を取りこぼす事象を確認したため戻し）。低閾値による偽陽性は別軸（クエリ拡張・相対スコア・top1-top2 差）で対応する設計。

## ナレッジベース構成

| 種別 | 内容 | 件数 |
|---|---|---|
| 公的マニュアル | 飼養衛生管理基準（鶏）、HPAI 防疫指針 本体・資料 1・資料 2、AW 指針（採卵鶏編）、鶏卵生産衛生管理ハンドブック、採卵鶏 HACCP 衛生管理マニュアル | 7 |
| 食品安全・鳥獣被害対策 | 厚労省サルモネラ広報、鶏卵選別包装施設 HACCP 手引書、野生鳥獣被害防止マニュアル（中型獣類編）、鳥獣保護管理基本指針、地方自治体のアライグマ・ハクビシン対策資料 | 7 |
| 現場ナレッジ（Markdown） | 鶏の基礎生態・解剖・視覚特性などの参考ノート（`knowledge/` 配下に出典別ディレクトリで管理） | 拡充中 |

家族ナレッジ追加機能（Step 6）は当初「Markdown 投稿フォーム」で実装する予定だったが、ナレッジ汚染リスクの議論を経て、Phase 3 で予定していた会話駆動抽出（KB あり + ユーザー追加情報パターン）を入口にする方針に再定義した。経緯は `docs/knowledge.md` および GitHub Issue #15 を参照。

## ディレクトリ構成

```
chicken-knowledge-rag/
├── CLAUDE.md             # プロジェクト固有の Claude Code 指示
├── README.md             # このファイル
├── amplify/              # Amplify Gen2 バックエンド定義
│   ├── auth/             # Cognito User Pool 設定（サインアップ無効）
│   ├── data/             # AppSync スキーマ + Conversation/Message + chat / summarize ルート
│   ├── functions/
│   │   ├── chat-handler/        # Bedrock Retrieve + Converse（TypeScript）
│   │   ├── summarize-handler/   # 履歴の累積要約（TypeScript）
│   │   └── evaluation-handler/  # Ragas 評価パイプライン（Python 3.12 + Container Image）
│   └── infra/            # CDK 拡張
│       ├── budget.ts             # AWS Budgets + ハードストップ用 IAM
│       ├── evaluation.ts         # Ragas 評価 nested stack
│       ├── hosting.ts            # Amplify Hosting（App + Branch）IaC
│       ├── iam.ts                # KB / Lambda 共通 IAM
│       ├── knowledge-base.ts     # S3 Vectors + Bedrock KB + DataSource
│       └── storage.ts            # docs / knowledge / image S3 バケット
├── amplify.yml           # Amplify Hosting ビルド設定
├── web/                  # Next.js App Router フロントエンド（静的エクスポート）
├── knowledge/            # 現場ナレッジ Markdown 原本（S3 knowledge-bucket へ同期）
├── evaluation/testset/   # Ragas 評価用テストセット
└── docs/                 # 設計ドキュメント
    ├── plan.md           # 実装計画と判断記録
    ├── spec.md           # 要求定義書
    ├── todo.md           # タスク管理
    └── knowledge.md      # 開発知見・ハマりポイント・決定事項
```

## 実装フェーズ

| フェーズ | 範囲 | 状態 |
|---|---|---|
| Phase 1（MVP） | テキスト RAG + 引用付き回答 + Lambda Function URL + 1 スレッドチャット | 完了 |
| Phase 1.5 | 認証 + マルチスレッド + 累積要約 + Amplify Hosting デプロイ + リブランド + スマホ対応 + Ragas 評価 + リスク階層プロンプト + KB miss logging（topScore 永続化）+ スレッドアーカイブ | おおむね完了。家族ナレッジ追加（Step 6）と精度チューニング系 Issue（#16 Phase 2、#20、#21、#28〜#34）が継続中 |
| Phase 2 | 画像入力（症状写真 → Vision LLM → KB 検索）、KB 不足領域 BI 画面（`/insights`） | 未着手 |
| Phase 3 | 会話型ナレッジ蓄積の本格版（インタビュー型・棚卸し型） | 未着手 |
| Phase 4 | GraphRAG / 音声入力 / IoT 連携 | 必要性が顕在化したら検討 |

## ローカル開発

```bash
# シークレット読み込み（毎回必須）
source ~/.secrets/chicken-knowledge-rag.env

# フロントエンド開発サーバー
cd web && npm install && npm run dev    # http://localhost:3000

# Amplify Gen2 サンドボックス（個人用バックエンド環境を AWS 上に立てる）
npx ampx sandbox --outputs-out-dir web   # amplify_outputs.json は web/ 配下に出力する
```

`web/amplify_outputs.json` は `npx ampx sandbox` または Amplify Hosting のビルド時に自動生成される。手動編集はしない。

AWS リソースを触る作業の前には、ローカルで `aws sts get-caller-identity` を実行して認証状態を確認すること。Bedrock KB / S3 Vectors のリージョンは ap-northeast-1 に揃える。

## デプロイ

本プロジェクトは「Amplify Sandbox スタックを本番として共有運用する」構成を採用している（家族のみの利用で複数環境を持つ必要がないため）。

- **バックエンド**（Cognito / AppSync / Lambda / DynamoDB / Bedrock KB / Amplify Hosting）は単一の Sandbox スタックに含まれており、`source ~/.secrets/chicken-knowledge-rag.env && npx ampx sandbox --once --outputs-out-dir web` で再デプロイする。`npx ampx sandbox delete` は Hosting も止まるため**禁止**。
- **フロントエンド**は `main` ブランチへのマージで Amplify Hosting が自動的にビルド・デプロイする（Next.js を `output: 'export'` で静的エクスポートし、`AMPLIFY_OUTPUTS_GZ_B64` 環境変数経由で `amplify_outputs.json` を渡す構成）。

Bedrock Knowledge Base のチャンキング戦略は **作成後に変更不可** のため、初期設定は `docs/knowledge.md` に判断根拠を記録している（Hierarchical chunking / parent 1500・child 300・overlap 60）。

## 評価

`amplify/functions/evaluation-handler/` に Ragas v1 評価パイプラインを配置している。月次の EventBridge Scheduler で `evaluation/testset/v1.json` を `chat-handler` に直接 invoke し、faithfulness / answer_relevancy / context_precision / context_recall の 4 指標を計測する。

Judge LLM も Nova Pro を使っているため self-eval bias がある点に注意（参考値として扱う）。詳細な Run ID とベースライン数値、移行に伴う指標変動の解釈は `docs/knowledge.md` 参照。

## 設計ドキュメント

詳細は `docs/` 配下を参照。

- `docs/spec.md` — 要求定義書。設計原則・アーキテクチャ・ナレッジベース設計・回答ポリシー・ガードレールまでの全仕様。
- `docs/plan.md` — 実装計画と技術判断の根拠。代替案との比較あり。
- `docs/todo.md` — タスクの完了・未完了の追跡。
- `docs/knowledge.md` — 開発中に得た知見、ハマったポイント、決定事項のログ。

## ライセンス

家族のプライベート利用を前提とした個人プロジェクト。コードを参考にする分には自由に閲覧してかまわないが、正式なライセンス付与はしていない。
