# タスク管理 — Chicken Knowledge RAG System

最新状態を保つこと。完了したらチェックを入れて、必要なら新規タスクを追加する。詳細は `spec.md` §9 を参照。

## 次回再開時のチェックリスト

最終更新: 2026-05-02 22:15 (Step 1 IAM/Budget/ハードストップ デプロイ成功時点)

1. **作業ブランチ**: `feature/aws-infrastructure-setup`（main 未マージ、3コミット済み）
2. **環境変数のロード**: `source ~/.secrets/chicken-knowledge-rag.env`（毎回必須、子プロセス用に export 済み）
3. **AWSアカウント**: `~/.secrets/chicken-knowledge-rag.env` 参照、リージョン ap-northeast-1
4. **既デプロイ済み Stack**: `amplify-chickenknowledgerag-tetutetu-sandbox-8023efca66`（Cognito + AppSync + Todo + ChickenRagInfra）
5. **次のタスク**: Step 1 残り（S3バケット 3種、Bedrock モデルアクセス有効化）→ Step 2（Bedrock KB + S3 Vectors）
6. **再デプロイ方法**: コード変更後に `source ~/.secrets/chicken-knowledge-rag.env && npx ampx sandbox --once`
7. **削除したい時**: `npx ampx sandbox delete`（対話確認あり）または CFn console で Stack 削除
8. **既知の制約**: IAM description は ASCII + Latin-1 のみ（日本語NG）、env ファイルは export 必須



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

## Step 4: 会話バックエンド（スコープB / Phase 1.5）

- [x] Lambda (Python 3.12) + Function URL で `retrieve_and_generate` を呼び出す最小実装（スコープB）
- [x] CDK拡張 (`amplify/infra/api.ts`) で Lambda + ManagedPolicy + Function URL 一括定義
- [x] `lambda/conversation_handler/index.py` で Bedrock 呼び出し + 引用元抽出
- [x] LambdaInvokePolicy: Retrieve / RetrieveAndGenerate / InvokeModel / GetInferenceProfile / UseInferenceProfile
- [x] curl で API疎通確認 ← **✅ スコープB 完了条件達成**
  - URL: Lambda Function URL（NONE 認証、CORS 許可）
  - 質問→引用付き回答（鶏卵生産衛生管理ハンドブック p13 引用）
- [x] Amplify Gen2 プロジェクト初期化（`npm create amplify`）（Step 0.5 で完了済み）
- [ ] `amplify/data/resource.ts` に `a.conversation()` ルート定義（Phase 1.5）
- [ ] Conversation Handler を AppSync 経由に切替（Phase 1.5）
- [ ] DynamoDB スキーマ確認（PK/SK・TTL・ULID採用）（Phase 1.5）
- [ ] EventBridge ルール作成（S3 ObjectCreated → StartIngestionJob）（Phase 1.5）

## Step 5: フロントエンド（スコープC / Phase 1.5）

- [x] Next.js 16 + Tailwind v4 + React 19 セットアップ（`web/` サブディレクトリ）
- [x] 1スレッド限定の超簡易チャット画面（認証なし、Lambda Function URL を fetch）
- [x] 引用元表示コンポーネント（ファイル名 + ページ番号）
- [x] ダークモード対応（OS追従）
- [x] Cmd/Ctrl+Enter 送信ショートカット
- [x] Playwright + Chromium で E2E smoke test 3本（初期表示 / KB範囲内回答 / KB範囲外）
- [x] 全テストpass（実ブラウザでの動作確認も完了）← **✅ スコープC 完了条件達成**
- [ ] `<Authenticator>` で Cognito 認証（Phase 1.5）
- [ ] Cognito User Pool に2名のユーザー登録（Phase 1.5）
- [ ] `<AIConversation>` でマルチスレッドチャットUI（Phase 1.5）
- [ ] スレッド一覧サイドバー実装（Phase 1.5）
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
