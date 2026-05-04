# タスク管理 — Chicken Knowledge RAG System

最新状態を保つこと。完了したらチェックを入れて、必要なら新規タスクを追加する。詳細は `spec.md` §9 を参照。

## 次回再開時のチェックリスト

最終更新: 2026-05-05 (Phase 1.5 **B-5 + リブランド + スマホ対応 完了**。PR #11/#12/#14 main マージ済み、現在 main クリーン)

### 次回セッション開始時にやること

1. **次の着手対象**: B-4 ナレッジ投稿フォーム ← `feature/knowledge-form` (Markdownエディタ + S3 + EventBridge自動Ingestion)
2. **環境準備**: `source ~/.secrets/chicken-knowledge-rag.env`（毎回必須）
3. **sandbox 実行時の注意**: 必ず `npx ampx sandbox --outputs-out-dir web` で実行する（amplify_outputs.json を web/ 配下に出力する設計）

### 直近の追加作業 (B-5 後にmainで実施済み)

- PR #11 `feature/amplify-hosting`: B-5 Amplify Hosting CDK 化 (マージ済み)
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
    - `summarize(existingSummary, messagesJson)` mutation: Haiku 4.5 で会話履歴を統合要約
    - `Conversation` モデル: title / summary / summarizedCount / expiresAt + messages (hasMany)、`allow.owner()` で所有者ガード
    - `Message` モデル: conversationId / role / content / citations(JSON) / hasKbResults / expiresAt、`allow.owner()`
  - **DynamoDB TTL**: Conversation / Message 両方に `expiresAt` 属性 (90日後の Unix epoch seconds) で TTL 有効化
  - **chat Lambda**: `amplify_outputs.json` の `custom.chatFunctionName` (TypeScript、Retrieve + Converse 統一構成)
  - **summarize Lambda**: `amplify_outputs.json` の `custom.summarizeFunctionName` (Haiku 4.5 で要約)
  - **Cognito User Pool**: `amplify_outputs.json` の `auth.user_pool_id`（User1/User2 登録済み、CONFIRMED + 永続パスワード）
  - **Amplify Hosting App**: `amplify_outputs.json` の `custom.amplifyHostingAppId` / `amplifyHostingDefaultDomain`（CDK で IaC 化、GitHub PAT は Secrets Manager の `chicken-rag/github-token` を参照）
  - フロント: `web/` (Next.js 16 + Authenticator + サイドバーマルチスレッドUI + 要約自動呼出、`output: 'export'` で静的サイト化)

### 主要コマンド

- ローカル起動: `cd web && npm run dev` → http://localhost:3000、サインインは User1/User2 のメアドと `~/.secrets/chicken-knowledge-rag.env` の `USER{1,2}_PASSWORD`
- 再デプロイ: `source ~/.secrets/chicken-knowledge-rag.env && npx ampx sandbox --once --outputs-out-dir web`
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
  - 質問3: "神奈川県でアライグマを捕獲する手続き" → 神奈川県第4次アライグマ防除実施計画から3引用 ✅

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

## Step 6: ナレッジ投稿フォーム（Phase 1.5）

- [ ] Markdownエディタ導入（react-md-editor 等を比較選定）
- [ ] YAML front matter テンプレート埋め込み
- [ ] `POST /knowledge` API 実装（Lambda）
- [ ] Lambda → S3 knowledge-bucket 保存
- [ ] EventBridge → StartIngestionJob 自動実行確認
- [ ] ナレッジ品質ガード設計の反映 — Issue #15 (構造化強制 / source_type / カテゴリ別取込ガード)

## Step 7: 精度チューニング（運用フェーズ）

- [ ] Bedrock Guardrails 設定（疾病・薬剤・緊急対応・卵食品安全・害獣捕獲カテゴリ、spec.md §5-2 の6カテゴリ）
- [ ] 専門家確認アラートのカスタムレスポンス設定
- [ ] システムプロンプト実装（コンテキスト限定回答ポリシー）
- [ ] RAGAS評価パイプライン構築（Faithfulness / Answer Relevancy / Context Precision / Context Recall）
- [ ] ベースラインスコア取得
- [ ] 中型獣類編が「ハクビシン」質問で retrieval されない件の調査（chunk size の見直し or `numberOfResults` 増 or リランカー導入）
- [ ] PDF メタデータ sidecar 戦略の決定（現状は sidecar 無し、source_type / category を付与するか Phase 1.5 で再設計）

## Step 8: 運用・拡張

- [ ] 配偶者向け簡易マニュアル作成
- [ ] 月次RAGAS評価のスケジュール化
- [ ] Phase 2（画像対応）着手判断
- [ ] Phase 3（会話型ナレッジ蓄積）着手判断
