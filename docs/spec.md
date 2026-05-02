# 養鶏特化RAGエージェント 要件定義書 v1.0

> Chicken Knowledge RAG System — Requirements Specification
>
> | 項目 | 値 |
> |---|---|
> | 作成日 | 2026-05-02 |
> | バージョン | v1.0 |
> | ステータス | 初版 / Claude Code実装用 |
> | 利用者 | 家族のみ（養鶏プロ含む） |
> | 対象規模 | 採卵鶏 150〜500羽 |

---

## 0. システム概要

採卵鶏の飼育に特化したRAGベースのAIエージェントを構築する。配偶者（現役養鶏プロ・500羽・3年の実績）と自身の2名が利用するプライベート用途のシステムであり、命を扱う性質上、精度の担保を最優先設計方針とする。

本システムの核心的価値は「現場3年分の暗黙知の体系化」にある。公的マニュアル・厳選論文を基盤とし、現場ナレッジをMarkdown形式で蓄積する三層構成のナレッジベースに、マルチスレッドチャットUIを組み合わせる。

---

## 1. 設計原則

### 1-1. 精度最優先（命を扱うシステム）

- ハルシネーション抑制を全設計判断の最上位に置く
- 回答には必ず出典（ドキュメント名・ページ番号・引用箇所）を明示する
- 「知らない」「確認が必要」と答えることを推奨する応答スタイルを採用する
- RAGAS等による定期的な評価パイプラインを設計に組み込む
- 疾病・薬剤・緊急対応に関する質問は、必ず獣医師への確認を促すアラートを付加する

> ⚠️ 鳥インフルエンザ・コクシジウム等の感染症、ニューカッスル病ワクチン等の薬剤投与に関する回答は、農水省飼養衛生管理基準の該当箇所を必ず引用したうえで、専門家への確認を促す文言を付加すること。

### 1-2. ナレッジ品質原則

- 「論文100本よりも公的マニュアル10本＋精選論文20〜30本＋現場ナレッジ」のハイブリッド構成を採用する
- ノイズ文書（意味的に近いが誤情報を含む文書）はRAG精度の最大の脅威であり、意図的な品質管理を行う
- 各ドキュメントにはソースタイプ（公的マニュアル / 論文 / 現場ナレッジ）を必ずメタデータとして付与する
- 将来、ソースタイプ別の重み付けリランキング（Cross-encoder reranker）を実装する余地を設計に確保する

### 1-3. コスト原則

- ユーザー2名の個人利用であり、OpenSearch Serverless（固定費 $175〜$350/月）は過剰
- S3 Vectors（完全従量課金）をベクトルストアとして採用し、月額 $20〜30 以内を目標とする
- 将来的に専門用語ハイブリッド検索が必要になった場合のみ OpenSearch Serverless に移行する

---

## 2. システムアーキテクチャ

### 2-1. 全体構成

```
【ナレッジ取り込みフロー】
ドキュメントPDF/MD → S3（原本バケット） → Bedrock KB Ingestion
  → Parse（自動） → Chunk（Hierarchical） → Embedding（Titan V2）
  → S3 Vectors インデックス

【テキスト入力フロー】
配偶者がUIでMarkdown入力 → API Gateway → Lambda
  → S3（ナレッジバケット）保存 → Ingestion自動トリガー

【画像入力フロー（拡張）】
鶏の症状写真 → S3（画像バケット） → Bedrock Nova Pro / Claude 3.7
  → テキスト化（症状記述） → KB検索 → 回答生成

【チャット回答フロー】
Next.js（Amplify Hosting） → Cognito認証 → AppSync（GraphQL）
  → Conversation Lambda → Bedrock RetrieveAndGenerate API
  → S3 Vectors（Top-K検索） → Claude（回答生成）
  → DynamoDB（会話履歴保存） → ストリーミング応答
```

### 2-2. AWSサービス構成

| サービス | 用途 | 設定値・補足 |
|---|---|---|
| Amazon S3（通常） | ドキュメント原本 | PDF/MD/画像格納。バケット分離: docs-bucket / knowledge-bucket / image-bucket |
| Amazon S3 Vectors | ベクトルストア | 東京リージョン(ap-northeast-1)対応。1024次元 cosine距離。完全従量課金 |
| Bedrock Knowledge Bases | RAGオーケストレーション | S3 Vectorsバックエンド。Hierarchical chunking（parent 1500 / child 300 / overlap 60） |
| Titan Text Embeddings V2 | Embeddingモデル | 1024次元、最大8192トークン。100+言語対応。日本語・英語混在ドキュメントに対応 |
| Claude Sonnet 4.5 | 回答生成LLM（精度重視） | コンテキスト参照・引用付き回答生成。疾病・薬剤質問時は必ず専門家アラートを付加 |
| Claude Haiku 4.5 | 回答生成LLM（速度重視） | 軽量質問・ナレッジ検索確認用。コスト最適化オプション |
| DynamoDB | 会話履歴管理 | Single Table Design。ULID採用。TTL 90日。PK=userId / SK=CONV#… / CHAT#\<id\>#MSG#… |
| API Gateway + Lambda | バックエンドAPI | ナレッジ投稿API（POST /knowledge）・会話CRUD API。Python 3.12 / boto3 |
| AWS Amplify Gen2 + AI Kit | フロントエンド | Next.js App Router。AppSync Subscription（ストリーミング）。Cognito User Pool認証 |
| Cognito User Pool | 認証 | 2名のユーザーのみ。Amplify UI `<Authenticator>` で実装 |
| EventBridge + Lambda | 自動Ingestion | S3 ObjectCreatedイベント → Bedrock KB StartIngestionJob。新規ドキュメント追加時に自動同期 |

---

## 3. ナレッジベース設計

### 3-1. 三層ナレッジ構成

| 優先度 | レイヤー | ソース例 | `source_type` |
|---|---|---|---|
| 最高 | 公的権威ソース | 飼養衛生管理基準(令和7年9月)、HPAI防疫指針(令和7年10月)、AW指針(採卵鶏編)、鶏卵生産衛生管理ハンドブック | `official_regulation` |
| 高 | 精選学術論文 | J-STAGE（Journal of Poultry Science）、Poultry Science誌OA論文。採卵鶏・日本の飼育条件に関連するもの20〜30本に厳選 | `research_paper` |
| 最高 | 現場ナレッジ | 配偶者が書くMarkdown形式のノウハウ・観察記録・SOP・ワクチン記録・ハクビシン対策記録など | `field_knowledge` |

> ⚠️ 「意味的に近いが誤情報を含む文書（ノイズ文書）」はRAG精度の最大の脅威（arXiv:2401.14887）。論文は必ず精選すること。採卵鶏・日本の飼育条件・500羽規模に無関係な論文は取り込まない。

### 3-2. 取得すべき一次ソース一覧

#### 公的マニュアル（必須取込）

| ドキュメント名 | URL |
|---|---|
| 飼養衛生管理基準（鶏）令和7年9月版 | https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/ |
| 高病原性鳥インフルエンザ防疫指針 令和7年10月版 | https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/ |
| AW指針（採卵鶏編）令和5年7月 | https://www.maff.go.jp/j/chikusan/sinko/animal_welfare.html |
| 鶏卵生産衛生管理ハンドブック（農場編） | https://www.maff.go.jp/j/syouan/seisaku/handbook/pdf/sairan.pdf |
| 採卵鶏の一般的衛生管理マニュアル（農場HACCP） | https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_haccp/pdf/06_chicken.pdf |

#### 論文ソース（J-STAGE / OA論文）

- Journal of Poultry Science: https://www.jstage.jst.go.jp/browse/jpsa
- 旧日本家禽学会誌(1964-2001): https://www.jstage.jst.go.jp/browse/jpsa1964/-char/ja
- 日本畜産学会報: https://www.jstage.jst.go.jp/browse/chikusan/-char/ja
- Poultry Science誌（Elsevier OA）: https://www.sciencedirect.com/journal/poultry-science
- CiNii Research（横断検索）: https://cir.nii.ac.jp
- 農研機構 AgriKnowledge: https://agriknowledge.affrc.go.jp/

> 論文の選定基準: ① 採卵鶏（肉用鶏は除外）、② 日本国内の飼育条件または汎用飼育技術、③ 疾病・飼料・換羽・生産性・ウェルフェア・衛生管理に直結するもの。20〜30本に厳選。

### 3-3. 現場ナレッジのMarkdownテンプレート

1ファイル = 1トピック = 300〜2000トークン（500〜3000文字）を目安とする。

```markdown
---
title: 「トピックの端的なタイトル」
date: YYYY-MM-DD
source_type: field_knowledge
category: [育成/飼料/疾病/衛生/害獣/設備/産卵]
breed: [ボリスブラウン/もみじ/他]
age_weeks: xx  # 週齢（数値型）
location: 第1鶏舎  # 任意
tags: [ワクチン, ニューカッスル病, 春季]  # コントロールドボキャブラリ使用
---
# 概要（必須・冒頭に1段落の要約を書く）
〇〇について。句点で文を終える。

## 詳細・手順

## 観察・経験則（現場のみが知るノウハウ）

## 注意点・リスク
```

> 重要: Bedrock KBはMarkdownの見出し階層をネイティブには認識しない（固定チャンキングで分割される）。Hierarchical chunking（parent 1500 / child 300 / overlap 60）を採用することで章節構造を活かす。チャンキング戦略はデータソース作成後に変更不可のため初期設定が重要。

---

## 4. チャットUIとフロントエンド

### 4-1. 機能要件

- ChatGPT / Claude.ai のようなマルチスレッドチャットUI
- スレッド一覧（左サイドバー）：スレッドの新規作成・一覧表示・再開・削除
- スレッド内チャット：ストリーミング表示、引用元表示（ドキュメント名・ページ番号）
- ナレッジ投稿フォーム：配偶者がMarkdownを書いて保存 → 自動Ingestion
- 画像アップロード（初期はUI実装のみ、バックエンド接続は拡張フェーズ）
- Cognito認証：2名のみアクセス可能

### 4-2. フロントエンド技術スタック

- Next.js App Router（TypeScript）
- AWS Amplify Gen2 + AI Kit（`a.conversation()` ルートで AppSync + DynamoDB + Cognito 一括生成）
- Amplify Hosting でのデプロイ
- `<AIConversation />` コンポーネントでストリーミング対応

> Amplify AI Kitを使うことで AppSync GraphQL API + Conversation Handler Lambda + DynamoDB会話履歴 + Cognito User Pool認証 + ストリーミング応答 が一括生成される。最小工数でChatGPT相当のスレッド管理が実現できる。

### 4-3. DynamoDB会話履歴設計（Single Table Design）

| アイテム種別 | PK | SK パターン |
|---|---|---|
| 会話メタデータ | `user_{userId}` | `CONV#{ulid}` |
| チャットメッセージ | `user_{userId}` | `CHAT#{convId}#MSG#{ulid}` |

- メッセージIDはULIDを採用（同一ミリ秒の複数書き込みでも時系列順序保証）
- TTL属性 `expires_at` を全アイテムに設定（90日後自動削除でコスト最適化）
- スレッド一覧: `begins_with("CONV#")` でクエリ
- 特定スレッドのメッセージ: `begins_with("CHAT#{convId}#MSG#")` で時系列取得

---

## 5. 精度担保設計

### 5-1. 基本設計方針

| 施策 | 内容 |
|---|---|
| 必須引用 | 全回答に RetrieveAndGenerate API の `retrievedReferences` を付加。ドキュメント名・S3 URI・ページ番号を表示 |
| ガードレール | Bedrock Guardrails設定: 疾病・薬剤・緊急対応カテゴリに「専門家確認アラート」を自動付加。農水省基準と矛盾する回答にはフラグ |
| Reranker | Amazon Rerank 1.0 または Cohere Rerank。Top-20取得 → Rerank → Top-5に絞り込み。中間ランク文書のU字型無視問題を回避 |
| チャンキング最適化 | Hierarchical chunking (parent:1500 / child:300 / overlap:60)。日本語は句点終端を徹底したMarkdown記述ルールで品質確保 |
| 定期RAGAS評価 | 月次でRAGAS（Faithfulness / Answer Relevancy / Context Precision / Context Recall）を評価。スコア低下時はチャンキング・プロンプト・ナレッジ品質を見直し |
| システムプロンプト | 「提供されたコンテキストのみに基づいて回答し、コンテキストに情報がない場合は『確認が必要です』と回答すること」を明示 |
| ナレッジ品質管理 | ドキュメント追加時のチェックリスト: source_type明記 / 採卵鶏関連か / 日本の飼育条件か / 500羽規模か / 重複チェック |

### 5-2. 疾病・緊急時の回答ポリシー

- **鳥インフルエンザ・コクシジウム等の感染症**: 農水省防疫指針の該当箇所を引用し、必ず家畜保健衛生所への連絡を促す
- **ワクチン・薬剤投与**: 製品添付文書と農水省基準を引用し、獣医師への確認を必ず促す
- **死亡事例・緊急症状**: 「直ちに獣医師・家畜保健衛生所に連絡してください」を回答の冒頭に表示

> 上記ポリシーはBedrock Guardrailsの「Denied topics」または「Custom responses」として設定し、プロンプトレベルに依存しない安全網として実装する。

---

## 6. 拡張計画（将来フェーズ）

### 6-1. Phase 2: マルチモーダル対応（画像入力）

鶏の症状画像・鶏小屋の状態写真・ハクビシン被害写真などを入力として受け付け、視覚情報を含めた診断支援を実現する（PoultryTalk方式、2025年実証済み）。

| コンポーネント | 実装内容 |
|---|---|
| Vision LLM | Claude 3.7 Sonnet または Amazon Nova Pro。画像を直接入力し症状テキスト化 |
| 画像S3バケット | `chicken-images-bucket`。JPG/PNG対応。メタデータに日付・鶏舎・品種・週齢を付与 |
| 画像→テキスト変換 | 「この画像の鶏の症状を獣医学的観点から詳細に記述してください」プロンプトでテキスト化 → KB検索 → 回答生成 |
| フロント拡張 | Next.jsのチャットUIにカメラ/ファイルアップロードを追加。Amplify Storageを利用 |

> 画像診断は必ずテキスト変換後にRAG検索を挟む。Vision LLMの直接診断回答は使用せず、必ずKBの文書に基づいた回答生成フローを経ること（精度原則の維持）。

---

### 6-2. Phase 3: 会話型ナレッジ蓄積機能（Guided Knowledge Capture）

ユーザーが「〇〇について保存しておきたい」と発話した瞬間をトリガーとして、AIが不足情報を質問で引き出し、会話の流れでナレッジを構造化・保存する機能。テキストをゼロから手打ちさせない「入力支援型ナレッジ蓄積」の実現を目指す。

#### 設計思想

ベクトル化の精度はドキュメントの構造品質に直結する。配偶者が持つ暗黙知（3年分の観察・経験則・失敗事例）は価値が高い一方、自由記述では必要なメタデータ（品種・週齢・症状・時期）が欠落しやすい。AIがインタビュアーとなり、保存に最適な構造に変換することで、ナレッジの品質と蓄積速度を両立する。

#### 会話フロー設計（5ステップ）

| Step | 処理 | 詳細 |
|---|---|---|
| 1 | トリガー検出 | ユーザーの発話に「保存したい」「記録しておきたい」「覚えておいて」等のキーフレーズを検出。または「ナレッジ追加モード」ボタンで明示起動 |
| 2 | カテゴリ推定 | 発話内容からカテゴリ（育成 / 飼料 / 疾病 / 衛生 / 害獣 / 設備 / 産卵）をLLMが推定し、必要な質問セットを動的に選択する |
| 3 | インタビュー開始 | カテゴリに応じた質問を1つずつ提示。回答が得られたら次の質問へ。すでに文中に含まれている情報は聞き返さない。必須項目が揃ったらStep 4へ |
| 4 | Markdownプレビュー生成 | 会話内容をYAML front matter + Markdown本文に自動変換してチャットUI上にプレビュー表示。ユーザーは確認・修正できる |
| 5 | 保存承認 | ユーザーが「保存」ボタンを押すと S3 knowledge-bucket に `.md` + `.md.metadata.json` として保存。EventBridge経由で StartIngestionJob が自動実行される |

#### カテゴリ別インタビュー質問セット

| カテゴリ | AIが聞く質問（不足している場合のみ） |
|---|---|
| 疾病 | ① 何羽が影響を受けましたか？ ② 症状が出始めた時期・週齢は？ ③ 具体的な症状（外観・行動・産卵・排泄）は？ ④ 対処した方法は？ ⑤ 結果はどうなりましたか？ ⑥ 獣医師や保健所に相談しましたか？ |
| 害獣対策 | ① 何の害獣ですか（ハクビシン・タヌキ・イタチ等）？ ② 被害の内容と規模は？ ③ 侵入経路はどこでしたか？ ④ どんな対策を試しましたか？ ⑤ 効果があった対策・なかった対策は？ |
| 育成・飼料 | ① 品種と週齢は？ ② 何を変えましたか（飼料・給水・環境等）？ ③ 変更前後の産卵率・体重・行動の変化は？ ④ いつから効果が出ましたか？ |
| 設備・鶏小屋 | ① どの設備・場所ですか？ ② 何を工夫・改善しましたか？ ③ 改善前の課題は何でしたか？ ④ 効果・注意点は？ ⑤ 使った材料・費用感は？ |
| 日常観察 | ① 対象の品種・週齢・鶏舎は？ ② いつ気づきましたか？ ③ 具体的に何を観察しましたか？ ④ 前回と比べて変化はありますか？ |

> 質問は必ず1つずつ提示する（複数同時質問はユーザーの認知負荷を上げ、回答の粒度が下がる）。すでに発話に含まれている情報は再質問しない。「わからない」「不明」の回答も記録する（欠損情報も重要なナレッジ）。

#### 生成されるMarkdownの例

```markdown
---
title: ハクビシン侵入対策（2026年春・第1鶏舎）
date: 2026-03-15
source_type: field_knowledge
category: 害獣
tags: [ハクビシン, 侵入対策, 第1鶏舎, 春季]
captured_by: conversation  # 会話型入力で生成
---
# 概要
2026年3月、第1鶏舎の床部分からハクビシンが侵入し鶏3羽が被害を受けた。
金属メッシュの増設と忌避剤の設置により再侵入を防止した。

## 被害状況
- 被害羽数: 3羽（死亡2羽、負傷1羽）

## 侵入経路と対策
- 侵入経路: 床と壁の接合部（隙間約5cm）。
- 対策: 19番金属メッシュで補強。忌避剤（木酢液）を周囲に設置。

## 効果・注意点
- 以降3か月間、再侵入なし。
- 木酢液は雨後に効果が薄れるため、2週間ごとに再塗布が必要。
```

#### 技術実装方針

| コンポーネント | 実装内容 |
|---|---|
| トリガー検出 | フロント側でキーフレーズを正規表現検出、またはLLMによる意図分類（`intent: knowledge_capture`）でモード切替 |
| インタビューLLM | 専用システムプロンプト（インタビュアーとして振る舞い、1問ずつ質問し、得られた情報を内部的に蓄積する）。Claude Haiku 4.5でコスト最適化 |
| Markdown変換 | 会話履歴 + 収集データをプロンプトに渡し、YAML front matter付きMarkdownを生成するLLM呼び出し（1回）。§3-3テンプレートに準拠 |
| プレビュー表示 | react-markdown等でチャットUI上にプレビュー。インライン編集は Phase 3.1 以降で対応 |
| 保存・Ingestion | 承認後、`POST /knowledge` API → Lambda → S3 knowledge-bucket保存（`.md` + `.md.metadata.json`）→ EventBridge → StartIngestionJob。既存フローを再利用 |
| captured_by メタデータ | 会話型で生成されたナレッジには `captured_by: conversation` を付与。手動入力（`captured_by: manual`）と区別し、将来の品質評価に活用 |

> 保存前の確認（プレビュー→承認）を必ず挟む。自動保存は採用しない。命に関わる情報の誤ったナレッジ化を防ぐため、ユーザーが内容を確認してから保存するフローを原則とする。

---

### 6-3. Phase 4: その他拡張

- **GraphRAG対応**: Amazon Neptune Analytics連携。「症状A → 原因B → 対処C」のような多段推論が必要になった場合（Crop GraphRAG 2025実証）
- **ハイブリッド検索**: OpenSearch Serverlessへのバックエンド移行。「サルモネラ・エンテリティディス」等の専門用語完全一致が重要になった段階で実施
- **音声入力**: 作業中の手が離せない状況での質問をAmazon Transcribeで音声→テキスト変換
- **鶏舎IoTデータ連携**: 温湿度センサー・産卵カウンターデータをAPIで参照するAgent拡張

---

## 7. Bedrock AgentCore / Agents 比較（現状維持の根拠）

現時点（2026年5月）では KB + Lambda直接呼び出しの構成で十分だが、将来の拡張性のため記録する。

| 選択肢 | 適合シナリオ | 本システムへの適用判断 |
|---|---|---|
| KB + Lambda（現構成） | RAG特化・シンプルなQ&A | ✅ 推奨。養鶏Q&Aに必要十分。Amplify AI Kitとの親和性が高い。月額$20〜30の低コストを維持できる |
| Agents for Bedrock | 外部API連携・複数ステップの推論・ツール呼び出し | 将来、「農業気象APIと連携して給餌量を自動調整」「ワクチンスケジュール自動提案」などの自律アクションが必要になった場合に採用を検討 |
| AgentCore | 長時間実行エージェント・マルチエージェント・MCP連携 | 2025年10月GA。8時間実行窓・A2Aプロトコル・MCPサーバー接続対応。現フェーズでは過剰。将来的にMCP経由でファーム管理システムとの連携が発生した場合に再評価 |

**結論: このままでいい。** Bedrock KBはAgents for Bedrockともネイティブ統合されているため、将来的なエージェント化は大きなアーキテクチャ変更なしに可能。

---

## 8. 月額コスト試算

| コンポーネント | 想定規模 | 月額試算 | 備考 |
|---|---|---|---|
| S3 Vectors（ベクトルストア） | 〜3,000チャンク | $0.01 | ほぼ無料 |
| S3（ドキュメント原本） | 〜2GB | $0.05 | |
| Titan Embeddings V2（初回） | 300ドキュメント取込 | $0.03（初回のみ） | 追加時のみ課金 |
| Claude Sonnet 4.5（LLM推論） | 月2,000クエリ | $6〜12 | 主な変動費 |
| DynamoDB（会話履歴） | 月1,000メッセージ | $0.01〜0.05 | |
| Cognito User Pool | 2名 | $0（無料枠内） | |
| Lambda / API Gateway | 低頻度 | $0〜0.01 | 無料枠内 |
| Amplify Hosting | 数GB配信 | $1未満 | |
| **合計** | | **月 $8〜15** | LLM利用量で変動 |

> 参考: OpenSearch Serverless採用時の最低コストは $175〜$350/月（固定費）。S3 Vectors採用で約20〜30倍のコスト差。

---

## 9. Claude Codeでの実装順序（推奨）

| Step | 作業 | 詳細 |
|---|---|---|
| 1 | AWS環境準備 | IAMロール設定（Bedrock KB用、Lambda用）。S3バケット作成: docs-bucket / knowledge-bucket / image-bucket（将来用）。ap-northeast-1（東京）リージョンを使用 |
| 2 | Bedrock KB作成 | Quick create で S3 Vectors バックエンドを選択。Titan Text Embeddings V2（1024次元）を指定。Hierarchical chunking設定（parent:1500 / child:300 / overlap:60）。S3 docs-bucketをデータソースに設定 |
| 3 | 初期ドキュメント取込 | 農水省PDFを5本程度ダウンロードしS3にアップロード。StartIngestionJobで動作確認。引用付き回答が返ることをAWS Consoleのテスト機能で確認 |
| 4 | 会話バックエンド | Amplify Gen2プロジェクト初期化（`npm create amplify`）。`amplify/data/resource.ts` に `a.conversation()` ルート定義。Lambda HandlerでBedrockAgentRuntime `retrieve_and_generate` を呼び出す実装 |
| 5 | フロントエンド | Next.js App Routerセットアップ。`<Authenticator>` コンポーネントでCognito認証。`<AIConversation>` コンポーネントでマルチスレッドチャットUI。引用ソース表示コンポーネントを追加実装 |
| 6 | ナレッジ投稿フォーム | Markdownエディタ（react-md-editor等）でナレッジ作成フォーム実装。`POST /knowledge` → Lambda → S3 knowledge-bucket保存 → EventBridge → StartIngestionJob |
| 7 | 精度チューニング | Bedrock Guardrails設定（疾病・薬剤アラート）。システムプロンプト調整。RAGAS評価パイプライン構築 |
| 8 | 運用・拡張 | 現場ナレッジの継続投稿。Phase 2（画像対応）・Phase 3（会話型ナレッジ蓄積）のバックエンド実装 |

---

## 参考一次ソース

| ドキュメント | URL |
|---|---|
| S3 Vectors GA発表 | https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-generally-available-with-increased-scale-and-performance/ |
| S3 Vectors + Bedrock KB公式ドキュメント | https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-bedrock-kb.html |
| Cost-effective RAG with S3 Vectors（公式ブログ） | https://aws.amazon.com/blogs/machine-learning/building-cost-effective-rag-applications-with-amazon-bedrock-knowledge-bases-and-amazon-s3-vectors/ |
| DynamoDB Chatbot Data Models（公式ブログ） | https://aws.amazon.com/blogs/database/amazon-dynamodb-data-models-for-generative-ai-chatbots/ |
| Amplify AI Kit + Conversation | https://docs.amplify.aws/react/ai/conversation/ |
| Bedrock KB Chunking公式ドキュメント | https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html |
| AgentCore GA発表 | https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/ |
| S3 Vectors制限事項公式ドキュメント | https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html |
| 飼養衛生管理基準（農水省） | https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/ |
| Journal of Poultry Science（J-STAGE） | https://www.jstage.jst.go.jp/browse/jpsa |