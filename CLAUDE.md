# CLAUDE.md — Chicken Knowledge RAG System

このファイルはプロジェクト固有の指示。全プロジェクト共通の個人設定は `~/.claude/CLAUDE.md` を参照すること。

## プロジェクト概要

100羽以上の鶏との暮らしを支援するRAGエージェント。
家族のうち1名は鶏 飼育3年経験者で、家族のみが利用するプライベートシステム。
鶏の生命と卵の食品安全の両面で命を扱う性質上、精度担保を最優先設計方針とする。

対象範囲:
- 飼養衛生管理 (家畜伝染病予防法上、100羽以上は届出対象)
- 自作鶏小屋 (建築中)
- 害獣対策 (カラス/タヌキ/ハクビシン/イタチ。物理防御 → 忌避フェーズ)
- AW・行動観察・日光浴などの飼育
- 日々得られる卵の活用 (保存・賞味期限・大量消費レシピ・食中毒予防)

詳細は `docs/spec.md`（要求定義書 v2.0）を参照すること。

## 設計の最重要原則

| 原則 | 内容 |
|---|---|
| 精度最優先 | ハルシネーション抑制を全判断の最上位に置く。回答には必ず出典を引用。「知らない」を推奨。疾病・薬剤・緊急対応・害獣捕獲・卵食品安全は専門家確認を促す。 |
| ナレッジ品質 | 公的マニュアル + 精選論文 + 現場ナレッジ(鶏小屋DIY/害獣対策/卵料理/個体観察)の三層構成。ノイズ文書（誤情報を含む類似文書）はRAG精度の最大の脅威のため、論文はペット飼育・日本の気候条件に親和的なもの 20〜30本に厳選。 |
| 低コスト | 月額 $20〜30 を目標。S3 Vectors（完全従量課金）採用。OpenSearch Serverless（月 $175〜$350 固定費）は採用しない。 |

## 技術スタック

| 層 | 技術 |
|---|---|
| 言語 | Python 3.12（バックエンド）/ TypeScript（フロントエンド） |
| ベクトルストア | Amazon S3 Vectors（ap-northeast-1） |
| RAGオーケストレーション | Amazon Bedrock Knowledge Bases |
| Embedding | Titan Text Embeddings V2（1024次元 cosine） |
| 回答生成LLM | Claude Sonnet 4.5（メイン）/ Claude Haiku 4.5（軽量質問用） |
| 会話バックエンド | AWS Amplify Gen2 + AI Kit（`a.conversation()`） |
| 認証 | Amazon Cognito User Pool（家族のみ） |
| 会話履歴 | Amazon DynamoDB（Single Table Design・ULID・TTL 90日） |
| バックエンドAPI | API Gateway + AWS Lambda（Python 3.12 / boto3） |
| 自動Ingestion | Amazon EventBridge + Lambda |
| フロントエンド | Next.js App Router（TypeScript）+ Amplify Hosting |
| ガードレール | Amazon Bedrock Guardrails |

## インフラ構成

| リソース | 用途 |
|---|---|
| S3 docs-bucket | 公的マニュアル・論文の原本（PDF）。鳥獣被害対策・卵衛生も含む |
| S3 knowledge-bucket | 現場ナレッジMarkdown (家族投稿、鶏小屋DIY/害獣対策/卵料理/個体観察 等) |
| S3 image-bucket | Phase 2用に予約（鶏の症状写真・害獣被害写真・小屋施工写真） |
| S3 Vectors index | Bedrock KBが管理するベクトルインデックス |
| Bedrock Knowledge Base | RAGオーケストレーション本体 |
| DynamoDB（会話履歴） | PK=`user_{userId}`, SK=`CONV#{ulid}` または `CHAT#{convId}#MSG#{ulid}`、TTL 90日 |
| Cognito User Pool | 家族のみ |
| Lambda（Conversation Handler） | Bedrock `retrieve_and_generate` を呼び出し |
| Lambda（Knowledge POST） | Markdown投稿 → S3保存 |
| EventBridge | S3 ObjectCreated → StartIngestionJob |

リージョンは **ap-northeast-1（東京）** で統一する。S3 Vectorsの東京リージョン対応を前提としているため。

## ディレクトリ構成（予定）

```
chicken-knowledge-rag/
├── CLAUDE.md            # このファイル
├── docs/
│   ├── plan.md          # 実装計画
│   ├── spec.md          # 要求定義書 v1.0
│   ├── todo.md          # タスク管理
│   └── knowledge.md     # 開発知見・決定事項
├── amplify/             # Amplify Gen2 設定（後日生成）
├── app/                 # Next.js App Router（後日生成）
├── lambda/              # Python Lambda関数（後日生成）
└── infra/               # IaC・補助スクリプト（必要に応じて）
```

## 開発時の注意

- 疾病・薬剤・緊急対応・害獣捕獲・卵食品安全に関する変更は、回答ポリシー（`spec.md` §5-2）に必ず照らして影響を確認する。命に関わるため軽微な変更でも慎重に。
- チャンキング戦略はデータソース作成後に変更不可。Bedrock KB再作成が必要になるため、初期設定の判断を docs/knowledge.md に記録する。
- ナレッジ投稿時は `source_type` メタデータを必ず付与する（`official_regulation` / `research_paper` / `field_knowledge`）。
- 現場ナレッジの category は spec.md §3-3 のカテゴリ別主要トピック例の語彙を使う(育成/飼料/疾病/衛生/害獣対策/鶏小屋建築/鶏小屋設備/産卵/卵料理/個体観察/行動・福祉)。
- 自動保存は採用しない。会話型ナレッジ蓄積（Phase 3）でも保存前のプレビュー → 承認フローを必ず挟む。

## 参考: 関連ドキュメントへのリンク

- 要求定義書（最も詳細な仕様）: `docs/spec.md`
- 実装計画と判断記録: `docs/plan.md`
- タスク管理: `docs/todo.md`
- 開発知見: `docs/knowledge.md`
