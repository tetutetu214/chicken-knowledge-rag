# タスク管理 — Chicken Knowledge RAG System

最新状態を保つこと。完了したらチェックを入れて、必要なら新規タスクを追加する。詳細は `spec.md` §9 を参照。

## 凡例

- [ ] 未着手
- [x] 完了
- [~] 進行中

## スコープ対応表

- **A: 最小確認版** = Step 0〜3（AWS Console で動作確認まで）— 5時間枠の必達ライン
- **B: API疎通版** = A + Step 4 の一部（Lambda + API Gateway で疎通）
- **C: フロント簡易版** = B + Step 5 の一部（Next.js 1スレッド限定UI）
- **Phase 1.5** = Step 4後半 + Step 5後半 + Step 6（認証・マルチスレッド・ナレッジ投稿フォーム）
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

## Step 1: AWS環境準備（スコープA）

- [x] ap-northeast-1 リージョンで作業することを確認
- [ ] AWS Budgets 作成: 月額 $30 上限（50%/80%/100% メールアラート）
- [ ] AWS Budgets Actions 設定: 100%超過時に Bedrock呼び出しDenyポリシーを自動アタッチ（ハードストップ）
- [ ] ハードストップ用 IAMポリシー作成: `bedrock:InvokeModel*` / `bedrock:Retrieve*` をDeny
- [ ] IAMロール作成: Bedrock KB実行用
- [ ] IAMロール作成: Lambda実行用（Step 4で利用）
- [ ] S3バケット作成: docs-bucket（公的マニュアル・論文の原本）
- [ ] S3バケット作成: knowledge-bucket（現場ナレッジMarkdown / Phase 1.5で利用）
- [ ] S3バケット作成: image-bucket（Phase 2で利用）
- [ ] 全バケットの暗号化・パブリックアクセスブロック確認
- [ ] Bedrock コンソールで Claude Sonnet 4.5 / Haiku 4.5 / Titan V2 のモデルアクセス有効化

## Step 2: Bedrock KB作成（スコープA）

- [ ] Bedrock コンソールから Quick create
- [ ] バックエンドに S3 Vectors を選択
- [ ] Embeddingモデル: Titan Text Embeddings V2（1024次元）
- [ ] Hierarchical chunking設定（parent 1500 / child 300 / overlap 60）
- [ ] データソース: docs-bucket を指定
- [ ] チャンキング戦略はデータソース作成後変更不可のため設定値を再確認

## Step 3: 初期ドキュメント取込（スコープA）

- [ ] 飼養衛生管理基準（鶏）令和7年9月版 ダウンロード・S3アップロード
- [ ] 高病原性鳥インフルエンザ防疫指針 令和7年10月版 ダウンロード・S3アップロード
- [ ] AW指針（採卵鶏編）令和5年7月 ダウンロード・S3アップロード
- [ ] 鶏卵生産衛生管理ハンドブック ダウンロード・S3アップロード
- [ ] 採卵鶏の一般的衛生管理マニュアル ダウンロード・S3アップロード
- [ ] StartIngestionJob 実行
- [ ] AWS Console のテスト機能で引用付き回答が返ることを確認 ← **スコープA 完了条件**

## Step 4: 会話バックエンド（スコープB / Phase 1.5）

- [ ] Lambda + API Gateway で `retrieve_and_generate` を呼び出す最小実装（スコープB）
- [ ] curl で API疎通確認（スコープB）← **スコープB 完了条件**
- [ ] Amplify Gen2 プロジェクト初期化（`npm create amplify`）（Phase 1.5）
- [ ] `amplify/data/resource.ts` に `a.conversation()` ルート定義（Phase 1.5）
- [ ] Conversation Handler Lambda 実装（Phase 1.5）
- [ ] DynamoDB スキーマ確認（PK/SK・TTL・ULID採用）（Phase 1.5）
- [ ] EventBridge ルール作成（S3 ObjectCreated → StartIngestionJob）（Phase 1.5）

## Step 5: フロントエンド（スコープC / Phase 1.5）

- [ ] Next.js App Router セットアップ（TypeScript）（スコープC）
- [ ] 1スレッド限定の超簡易チャット画面（認証なし）（スコープC）← **スコープC 完了条件**
- [ ] `<Authenticator>` で Cognito 認証（Phase 1.5）
- [ ] Cognito User Pool に2名のユーザー登録（Phase 1.5）
- [ ] `<AIConversation>` でマルチスレッドチャットUI（Phase 1.5）
- [ ] スレッド一覧サイドバー実装（Phase 1.5）
- [ ] 引用ソース表示コンポーネント実装（ドキュメント名・ページ番号）（Phase 1.5）
- [ ] Amplify Hosting にデプロイ（Phase 1.5）

## Step 6: ナレッジ投稿フォーム（Phase 1.5）

- [ ] Markdownエディタ導入（react-md-editor 等を比較選定）
- [ ] YAML front matter テンプレート埋め込み
- [ ] `POST /knowledge` API 実装（Lambda）
- [ ] Lambda → S3 knowledge-bucket 保存
- [ ] EventBridge → StartIngestionJob 自動実行確認

## Step 7: 精度チューニング（運用フェーズ）

- [ ] Bedrock Guardrails 設定（疾病・薬剤・緊急対応カテゴリ）
- [ ] 専門家確認アラートのカスタムレスポンス設定
- [ ] システムプロンプト実装（コンテキスト限定回答ポリシー）
- [ ] RAGAS評価パイプライン構築（Faithfulness / Answer Relevancy / Context Precision / Context Recall）
- [ ] ベースラインスコア取得

## Step 8: 運用・拡張

- [ ] 配偶者向け簡易マニュアル作成
- [ ] 月次RAGAS評価のスケジュール化
- [ ] Phase 2（画像対応）着手判断
- [ ] Phase 3（会話型ナレッジ蓄積）着手判断
