# 実装計画 — Chicken Knowledge RAG System

> 詳細仕様は `docs/spec.md`（要求定義書 v2.0）を参照する。本ファイルは仕様を実装に落とし込むための計画と判断記録。

## プロジェクト概要

100羽以上の鶏との暮らし（自作鶏小屋 + 害獣対策 + 卵の活用）を支援するRAGエージェントを家族で利用するプライベートシステムとして構築する。鶏の生命と卵の食品安全の両面で命を扱う性質上、精度担保を最優先とする。

スコープA+B+C 完走済み。Phase 1.5 のうち Step 5 (Cognito認証 + マルチスレッド + Amplify Hosting デプロイ) まで完了し、本番URLで配偶者公開可能な状態。残るは Step 6 (家族ナレッジ追加機能) と Step 7 (精度チューニング)。

Step 6 は当初「Markdown 投稿フォーム」だったが、ナレッジ汚染リスクの議論を経て **会話駆動抽出 (KBあり+ユーザー追加情報パターン) を入口とする方針** に2026-05-05に再定義 (Issue #15、knowledge.md 同日参照)。Phase 3 (会話型ナレッジ蓄積) の一部を Phase 1.5 に前倒した形。

## 設計の柱（最重要原則）

精度最優先、ナレッジ品質、低コストの3軸で全判断を行う。詳細は `spec.md` §1 を参照。

- 精度: 必ず出典を引用、疾病・薬剤・卵食品安全・害獣捕獲は専門家確認を促す
- ナレッジ品質: 公的マニュアル + 精選論文 + 現場ナレッジ(鶏小屋DIY/害獣対策/卵料理/個体観察)の三層構成
- コスト: 月額 $20〜30 を目標（S3 Vectors採用）

## アーキテクチャ概要

詳細は `spec.md` §2 を参照。要点のみ記載する。

- ベクトルストア: S3 Vectors（ap-northeast-1）
- RAGオーケストレーション: Bedrock Knowledge Bases
- Embedding: Titan Text Embeddings V2（1024次元）
- 回答生成LLM: Claude Sonnet 4.5（精度重視）/ Claude Haiku 4.5（軽量質問用）
- フロント: Next.js App Router + Amplify Gen2 + AI Kit
- 認証: Cognito User Pool（家族のみ）
- 会話履歴: DynamoDB Single Table Design（ULID + TTL 90日）

## 実装フェーズ

| フェーズ | 範囲 | 完了条件 |
|---|---|---|
| MVP（Phase 1） | テキストRAG・マルチスレッドチャット・**会話駆動の家族ナレッジ追加** | 公的マニュアル取込済、引用付き回答が返る、家族が会話の中からナレッジ化候補を承認・保存できる |
| Phase 2 | 画像入力（症状写真→テキスト化→KB検索） | Vision LLMでテキスト化された結果がRAGに渡る |
| Phase 3 | 会話型ナレッジ蓄積の本格版 (インタビュー型・棚卸し型) | カテゴリ別インタビューでMarkdownを生成・承認後に保存。会話事後抽出と並行運用 |
| Phase 4 | GraphRAG / 音声入力 / IoT連携 | 必要性が顕在化したタイミングで個別検討 |

本計画書は MVP（Phase 1） を対象とする。Phase 3 の会話事後抽出パターンのみ Phase 1.5 (Step 6) に前倒し。

## 直近の実装順序（MVP）

`spec.md` §9 の Step 1〜7 をベースに、`docs/todo.md` でタスク管理する。要点は次の通り。

1. AWS環境準備（IAMロール・S3バケット3種・リージョン ap-northeast-1・AWS Budgets）
2. Bedrock KB作成（S3 Vectorsバックエンド・Hierarchical chunking）
3. 初期ドキュメント取込（農水省PDF 5本すべて）
4. 会話バックエンド（Amplify Gen2 + `a.conversation()`）
5. フロントエンド（Next.js + `<Authenticator>` + `<AIConversation>`）
6. 家族ナレッジ追加機能（会話駆動抽出 + 承認 UI + S3 + EventBridge、Issue #15 で設計議論中）
7. 精度チューニング（Guardrails + システムプロンプト + Issue #17 RAGAS + Issue #16 不足領域分析）

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
| ベクトルストア | S3 Vectors | OpenSearch Serverless | 個人利用で固定費 $175〜$350/月は過剰。S3 Vectorsは完全従量課金で月 $0.01 規模 |
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

- 配偶者の利用開始想定時期（MVPの完成目標日）— Step 5 完了で公開可能ライン到達済み、Step 6/7 は鶏小屋完成と並行で進める
- 害獣対策: 物理防御フェーズ (現状) → 忌避フェーズ (鶏小屋完成後) で必要なナレッジが変化する。Step 6 の家族ナレッジ追加機能でフェーズ別に蓄積
- 所在自治体は確定済み (`~/.secrets/chicken-knowledge-rag.env` 経由、docs には記載しない)
- 鶏の品種 — ナレッジ抽出時の breed 項目で絞り込み可能にしたい
- 卵食品安全のガードレール文言の最終確認（家族以外への譲渡時の注意喚起）

## 現在の到達点 (2026-05-05)

- Step 5 完了 = 配偶者公開可能 (本番URL稼働、Cognito 認証 + マルチスレッド + 累積要約 + Hosting CDK化 + リブランド + スマホ対応)
- Step 6 = 設計議論中 (会話駆動抽出方針、Issue #15)
- Step 7 = #22 Sonnet 4.6 切替 (PR #23) / #18 systemPrompt リスク階層化 (PR #24) / #17 Ragas 評価パイプライン v1 (ベースライン取得済) 完了。残: #16 不足領域分析 (#17 ベースライン inputs 活用可) / #20 メタデータsidecar / #21 ユーザー不満記録
- Phase 2 = Issue #19 として切り出し済み (画像入力対応)
- 横断: Issue #13 (モデル切替)
- 配偶者向けマニュアルは廃案 (UI が分かりやすければ不要、2026-05-05 ユーザー判断)

## KB 拡充の3経路 (2026-05-05 確定)

すべての KB 拡充タスクはこの3経路のどれかに対応する。

| # | 経路 | 入口 | 出口 | 関連 |
|---|---|---|---|---|
| [1] 公的資料追加 | てつてつが資料を探す | S3 docs-bucket → 自動 Ingestion | 既存運用 |
| [2] 家族ナレッジ追加 | 会話駆動抽出 + 承認 UI | S3 knowledge-bucket → 自動 Ingestion | Step 6, Issue #15 |
| [3] 不足領域分析 | KBミスヒット質問のログ | てつてつへの可視化レポート | Step 7, Issue #16 |

## Issue #16 Phase 2 — `/insights` BI 画面の実装方針 (2026-05-16)

KB 拡充の経路 [3] の出口。Phase 1 (`topScore` の DDB 保存) は PR #27/#47 で完了済み。本フェーズは「集めたログを家族のみで見返し、棚卸サイクルに乗せる」UI を作る。

### スコープ

- ブランチ: `feature/insights-dashboard`
- 新規ページ: `web/app/insights/page.tsx` (家族メンバー のサインインを前提、`app/layout.tsx` の Authenticator wrap に乗る)
- 既存サイドバーから `/insights` への導線を追加 (`web/app/page.tsx`)
- 単体テスト + Playwright E2E + docs 更新を含めて 1 PR で完結

### データ取得戦略

- `client.models.Message.list({ limit: 1000, selectionSet: MESSAGE_FIELDS })` で全件取得し、フロントで仕分け
- 「未解決質問」= `hasKbResults=false` の assistant メッセージから逆引きして、同 `conversationId` の直前 user メッセージとペア化
- `topScore != null` フィルタで PR #47 以前の NULL 22 件を自動除外
- 採用理由: 家族規模 (数百件) では転送量も RCU も誤差。`filter` を JS に追い出すと関連計算 (assistant 直前の user) が自然に書ける。filter / GSI 化は将来数千件超えで再検討
- セキュリティは `allow.owner()` resolver で担保 (他人の Message は AppSync が返さない)

### 画面構成 (上から下)

| 区画 | 内容 |
|---|---|
| ヘッダー | 「📊 KB不足領域分析」+「← 会話に戻る」リンク |
| サマリーカード | 全質問数 / 未解決数 / 直近30日の未解決 / assistant 平均 topScore |
| 月次棒グラフ | recharts `BarChart`、X=月 / Y=未解決質問件数、過去 12 ヶ月 |
| topScore ヒストグラム | recharts `BarChart`、assistant 全件を 0.05 刻み (20 ビン)、閾値 0.7 を `ReferenceLine` で縦線表示 |
| 未解決質問一覧 | テーブル: createdAt / 質問テキスト (省略表示) / topScore / 会話タイトル |
| CSV ダウンロード | 未解決質問一覧を CSV 化、列 = createdAt, question, topScore, conversationTitle, conversationId |

### 技術選定

| 項目 | 採用 | 根拠 |
|---|---|---|
| グラフライブラリ | **recharts** | SVG/React コンポーネント方式で DevTools・Tailwind との相性◎、a11y も SVG ノードとして見える。Issue #16 で chart.js とともに候補に挙がっていたが家族規模で点数が少ないため SVG の重さ問題は出ない。詳細トレードオフは `knowledge.md` 2026-05-16 参照 |
| CSV 出力 | **自前 (Blob + ObjectURL)** | 列が少なく (5 列) エスケープ要件もシンプル。csv-stringify / papaparse のような依存追加は将来カラム数が増えてから |
| 集計ロジックの場所 | **`web/lib/insights.ts` 純関数** | Vitest で単体テストできる構造に切り出す。月次ビン化・ヒストグラムビン化・user-assistant ペアリング・CSV 生成を分離 |
| 認証 | **既存 Authenticator wrap** | `app/layout.tsx` で wrap 済みなので `/insights` も自動で認証ガードに入る (新規実装ゼロ) |

### テスト方針

- **単体 (Vitest)**: `lib/insights.ts` の純関数 — `pairUserAssistant` / `monthlyBuckets` / `topScoreHistogram` / `toCsv`
- **E2E (Playwright)**: `tests/insights.spec.ts` で storageState 経由でサインイン → `/insights` 遷移 → サマリーカード・グラフ・テーブル・CSV ボタンが揃うことを確認
  - Amplify Data の load 完了は `useState` → DOM 属性マーカー (`data-insights-loaded="true"`) で待つ (空配列の初期描画を「ロード完了」と誤判定しないため)
- 単体 41 件 / Playwright 6 件 (PR #48 時点) に + テストを追加する形

### スコープ外 (Phase 3 以降 / 別 PR)

- LLM 補助分類 (`analyzeGaps` mutation, Haiku 4.5 で未解決質問をカテゴリ語彙に分類) → Issue #16 Phase 3
- カテゴリ自動付与 / フィルタ
- 一覧から会話への直接遷移 (`/?thread=xxx`) → 現状クエパラでスレッド開く実装ないため別タスク
