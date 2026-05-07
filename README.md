# Chicken Knowledge RAG System

ペット鶏との暮らしを支援する RAG（Retrieval-Augmented Generation）エージェント。家族のプライベート用途で運用するシステムで、鶏の生命と卵の食品安全という二つの「命を扱う」性質から、精度担保を最優先の設計方針としている。

公的マニュアル（農林水産省の飼養衛生管理基準・HPAI 防疫指針・AW 指針など）を権威基盤とし、家族が現場で蓄える Markdown ナレッジ（鶏小屋 DIY 記録、害獣対策、個体観察、卵料理レシピなど）を組み合わせた三層構成のナレッジベースに、引用付きで回答するチャット UI を被せた構成になっている。

## なぜこのシステムか

家畜伝染病予防法上、一定規模以上の飼育は届出対象であり、ペット用途であっても防疫義務が生じる。鳥インフルエンザやサルモネラなど、判断を誤ると鶏の命や食中毒に直結する領域を扱うため、「LLM が知ったかぶりで答える」状況を構造的に避ける必要がある。

そこで本システムは次の方針を取る。

- 回答には必ず出典（ドキュメント名・該当箇所）を付ける
- 「知らない」「確認が必要」と答えることを推奨する応答スタイル
- 疾病・薬剤・緊急対応・害獣捕獲・卵食品安全のカテゴリでは、必ず専門家確認を促すアラートを付加する
- 論文は「数より精度」。ペット飼育・日本の気候条件に親和的なものを精選し、ノイズ文書による精度劣化を防ぐ

## アーキテクチャ概要

ベクトルストアに Amazon S3 Vectors（完全従量課金）を採用し、固定費が高い OpenSearch Serverless を回避することで個人利用に見合う運用コストを目標としている。RAG オーケストレーションは Amazon Bedrock Knowledge Bases に任せ、回答生成は Claude Sonnet 4.5（精度重視）と Claude Haiku 4.5（軽量質問用）を使い分ける。

| 層 | 技術 |
|---|---|
| 言語 | Python 3.12（バックエンド）/ TypeScript（フロントエンド） |
| ベクトルストア | Amazon S3 Vectors（ap-northeast-1） |
| RAG オーケストレーション | Amazon Bedrock Knowledge Bases |
| Embedding | Titan Text Embeddings V2（1024 次元 cosine） |
| 回答生成 LLM | Claude Sonnet 4.5（メイン）/ Claude Haiku 4.5（軽量） |
| 会話バックエンド | AWS Amplify Gen2 + AI Kit（`a.conversation()`） |
| 認証 | Amazon Cognito User Pool |
| 会話履歴 | Amazon DynamoDB（Single Table Design・ULID・TTL 90 日） |
| 自動 Ingestion | Amazon EventBridge + Lambda（S3 ObjectCreated → StartIngestionJob） |
| フロントエンド | Next.js App Router + Amplify Hosting |
| ガードレール | Amazon Bedrock Guardrails |

リージョンは S3 Vectors の東京対応を前提に **ap-northeast-1（東京）** で統一している。

データソースは S3 上で `docs-bucket`（公的マニュアル・論文 PDF）、`knowledge-bucket`（家族の Markdown ナレッジ）、`image-bucket`（Phase 2 用予約。症状写真や害獣被害写真）の 3 バケットに分けて管理する。新しいファイルが置かれると EventBridge 経由で Bedrock KB の Ingestion ジョブが自動で走る。

## ディレクトリ構成

```
chicken-knowledge-rag/
├── CLAUDE.md             # プロジェクト固有の Claude Code 指示
├── README.md             # このファイル
├── amplify/              # Amplify Gen2 バックエンド定義
│   ├── auth/             # Cognito User Pool 設定
│   ├── data/             # AppSync スキーマ + a.conversation() 定義
│   ├── functions/        # Lambda 関数群
│   │   ├── chat-handler/        # Bedrock retrieve_and_generate 呼び出し
│   │   ├── evaluation-handler/  # RAGAS 評価パイプライン
│   │   └── summarize-handler/   # 会話要約
│   └── infra/            # 補助 IaC スクリプト
├── amplify.yml           # Amplify Hosting ビルド設定
├── web/                  # Next.js App Router フロントエンド
├── docs/                 # 設計ドキュメント
│   ├── plan.md           # 実装計画と判断記録
│   ├── spec.md           # 要求定義書
│   ├── todo.md           # タスク管理
│   └── knowledge.md      # 開発知見・ハマりポイント・決定事項
└── evaluation/           # 精度評価用テストセット
    └── testset/
```

## 実装フェーズ

| フェーズ | 範囲 | 状態 |
|---|---|---|
| Phase 1（MVP） | テキスト RAG + マルチスレッドチャット + 認証 + Amplify Hosting デプロイ | 完了 |
| Phase 1.5 | 家族ナレッジ追加機能（会話駆動抽出 + 承認 UI）+ 精度チューニング | 進行中 |
| Phase 2 | 画像入力（症状写真 → テキスト化 → KB 検索） | 未着手 |
| Phase 3 | 会話型ナレッジ蓄積の本格版（インタビュー型・棚卸し型） | 未着手 |
| Phase 4 | GraphRAG / 音声入力 / IoT 連携 | 必要性が顕在化したら検討 |

Phase 1.5 の家族ナレッジ追加機能は、当初「Markdown 投稿フォーム」で実装する予定だったが、ナレッジ汚染リスクの議論を経て、Phase 3 で予定していた会話駆動抽出（KB あり + ユーザー追加情報パターン）を入口にする方針に再定義した。経緯は `docs/knowledge.md` および GitHub Issue #15 を参照。

## ローカル開発

```bash
# フロントエンド開発サーバー
cd web
npm install
npm run dev   # http://localhost:3000

# Amplify Gen2 サンドボックス（個人用バックエンド環境を AWS 上に立てる）
npx ampx sandbox
```

`web/amplify_outputs.json` は `npx ampx sandbox` または Amplify Hosting のビルド時に自動生成される。手動編集はしない。

AWS リソースを触る作業の前には、ローカルで `aws sts get-caller-identity` を実行して認証状態を確認すること。Bedrock Knowledge Bases や S3 Vectors のリージョンは ap-northeast-1 に揃える。

## デプロイ

`main` ブランチへのマージで Amplify Hosting が自動的にビルド・デプロイする。バックエンド（Cognito / AppSync / Lambda / DynamoDB）も Amplify Gen2 経由で同時に更新される。

Bedrock Knowledge Base 本体は別管理（CDK もしくは手動）で、データソースのチャンキング戦略は **作成後に変更不可** のため、初期設定は `docs/knowledge.md` に判断根拠を記録している（Hierarchical chunking / parent 1500・child 300・overlap 60）。

## 設計ドキュメント

詳細は `docs/` 配下を参照。

- `docs/spec.md` — 要求定義書。設計原則・アーキテクチャ・ナレッジベース設計・回答ポリシー・ガードレールまでの全仕様。
- `docs/plan.md` — 実装計画と技術判断の根拠。代替案との比較あり。
- `docs/todo.md` — タスクの完了・未完了の追跡。
- `docs/knowledge.md` — 開発中に得た知見、ハマったポイント、決定事項のログ。

## ライセンス

家族のプライベート利用を前提とした個人プロジェクト。コードを参考にする分には自由に閲覧してかまわないが、正式なライセンス付与はしていない。
