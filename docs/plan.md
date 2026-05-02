# 実装計画 — Chicken Knowledge RAG System

> 詳細仕様は `docs/spec.md`（要求定義書 v1.0）を参照する。本ファイルは仕様を実装に落とし込むための計画と判断記録。

## プロジェクト概要

採卵鶏（150〜500羽）の飼育に特化したRAGエージェントを家族のみで利用するプライベートシステムとして構築する。命を扱う性質上、精度担保を最優先とする。

## 設計の柱（最重要原則）

精度最優先、ナレッジ品質、低コストの3軸で全判断を行う。詳細は `spec.md` §1 を参照。

- 精度: 必ず出典を引用、疾病・薬剤質問は獣医師確認を促す
- ナレッジ品質: 公的マニュアル + 精選論文 + 現場ナレッジの三層構成
- コスト: 月額 $20〜30 を目標（S3 Vectors採用）

## アーキテクチャ概要

詳細は `spec.md` §2 を参照。要点のみ記載する。

- ベクトルストア: S3 Vectors（ap-northeast-1）
- RAGオーケストレーション: Bedrock Knowledge Bases
- Embedding: Titan Text Embeddings V2（1024次元）
- 回答生成LLM: Claude Sonnet 4.5（精度重視）/ Claude Haiku 4.5（軽量質問用）
- フロント: Next.js App Router + Amplify Gen2 + AI Kit
- 認証: Cognito User Pool（2名のみ）
- 会話履歴: DynamoDB Single Table Design（ULID + TTL 90日）

## 実装フェーズ

| フェーズ | 範囲 | 完了条件 |
|---|---|---|
| MVP（Phase 1） | テキストRAG・マルチスレッドチャット・ナレッジ投稿フォーム | 公的マニュアル取込済、引用付き回答が返る、配偶者がMarkdown投稿できる |
| Phase 2 | 画像入力（症状写真→テキスト化→KB検索） | Vision LLMでテキスト化された結果がRAGに渡る |
| Phase 3 | 会話型ナレッジ蓄積（Guided Knowledge Capture） | カテゴリ別インタビューでMarkdownを生成・承認後に保存 |
| Phase 4 | GraphRAG / 音声入力 / IoT連携 | 必要性が顕在化したタイミングで個別検討 |

本計画書は MVP（Phase 1） を対象とする。

## 直近の実装順序（MVP）

`spec.md` §9 の Step 1〜7 をベースに、`docs/todo.md` でタスク管理する。要点は次の通り。

1. AWS環境準備（IAMロール・S3バケット3種・リージョン ap-northeast-1・AWS Budgets）
2. Bedrock KB作成（S3 Vectorsバックエンド・Hierarchical chunking）
3. 初期ドキュメント取込（農水省PDF 5本すべて）
4. 会話バックエンド（Amplify Gen2 + `a.conversation()`）
5. フロントエンド（Next.js + `<Authenticator>` + `<AIConversation>`）
6. ナレッジ投稿フォーム（Markdownエディタ + S3 + EventBridge）
7. 精度チューニング（Guardrails + システムプロンプト + RAGAS）

## 5時間枠での到達目標（A→B→C順）

5時間でフルMVPは不可能なため、段階的に積み上げる。Aを必達、B・Cは余力に応じて。

| スコープ | 範囲 | 完了条件 |
|---|---|---|
| A: 最小確認版 | AWS環境準備 + Bedrock KB作成 + 公的マニュアル5本取込 + AWS Budgets（アラート + ハードストップ）| AWS Console のテスト機能で引用付き回答が返る |
| B: API疎通版 | A + Lambda + API Gateway で `retrieve_and_generate` を実行 | curl 等で API経由 で回答取得できる |
| C: フロント簡易版 | B + Next.js で1スレッド限定の超簡易チャット画面（認証・スレッド管理なし） | ブラウザでチャット風に質問・回答ができる |

C完了後にPhase 1.5として認証・マルチスレッド・ナレッジ投稿フォームを追加する。

## 重要な技術判断と根拠

| 判断 | 採用 | 不採用 | 理由 |
|---|---|---|---|
| ベクトルストア | S3 Vectors | OpenSearch Serverless | 個人利用2名で固定費 $175〜$350/月は過剰。S3 Vectorsは完全従量課金で月 $0.01 規模 |
| Embedding | Titan V2 | Cohere Embed | 1024次元・8192トークン・100+言語対応。日本語英語混在ドキュメントに対応 |
| チャンキング | Hierarchical（parent 1500/child 300/overlap 60） | Fixed / Semantic | 章節構造を活かしつつ精度を確保。データソース作成後に変更不可のため初期決定が重要 |
| 回答生成LLM | Claude Sonnet 4.5（メイン） | GPT-4o / Gemini | Bedrock統合・引用付き回答・日本語精度。コスト最適化用にHaiku 4.5を併用 |
| 会話バックエンド | Amplify AI Kit | 自前実装 | AppSync + Lambda + DynamoDB + Cognito + ストリーミングを一括生成。最小工数 |
| エージェント方式 | KB + Lambda直接 | Agents for Bedrock / AgentCore | Q&A特化なら直接呼び出しで十分。将来の拡張時に移行可能 |

## 確定事項（2026-05-02）

着手前のすり合わせで以下が確定した。

| 項目 | 内容 |
|---|---|
| AWSアカウント | `~/.secrets/chicken-knowledge-rag.env` を参照（パブリックリポジトリのためdocsに直書きしない） |
| リージョン | ap-northeast-1（東京） |
| IAM権限 | 現在のCLIユーザーで必要な権限を都度作成して進める |
| 初期取込ドキュメント | 公的マニュアル5本すべてを一括取込（論文はPhase 1.5で後追い） |
| 月額予算上限 | $30/月 |
| 予算ガード | AWS Budgets で「アラート通知」+「ハードストップ（Bedrock呼び出しDeny）」の2段構え |
| 5時間スコープ | A → B → C の順で必達Aを優先 |

## 残課題（てつてつ確認待ち）

- 配偶者の利用開始想定時期（MVPの完成目標日）— 急ぎでなければPhase 1.5でOK
