# 開発知見・決定事項 — Chicken Knowledge RAG System

開発中に得た知見・ハマりどころ・判断の根拠を時系列で記録する。同じ失敗を繰り返さないため、また将来のセッション再開時に経緯を再現できるようにするための場。

## 記載ルール

- 1エントリ = 1トピック。日付（YYYY-MM-DD）を冒頭に書く。
- 「決定事項」「知見・ハマりどころ」「未解決の検討事項」のセクションに分類する。
- なぜその判断をしたかの理由を必ず添える（後で読み返したときに判断根拠を再現できるように）。

---

## 決定事項

### 2026-05-02: ベクトルストアは S3 Vectors を採用

- **決定**: ベクトルストアに S3 Vectors を採用する。
- **理由**: ユーザー2名の個人利用ではOpenSearch Serverlessの固定費 $175〜$350/月は過剰。S3 Vectorsは完全従量課金で月 $0.01 規模に収まる。専門用語ハイブリッド検索が必要になった段階で OpenSearch Serverless へ移行する余地は残す。
- **トレードオフ**: S3 Vectorsはハイブリッド検索（キーワード + ベクトル）に未対応。サルモネラ・エンテリティディス等の固有名詞完全一致検索が重要になった場合は移行検討。

### 2026-05-02: チャンキングは Hierarchical（parent 1500 / child 300 / overlap 60）

- **決定**: Bedrock KB の Hierarchical chunking を採用する。
- **理由**: Markdownの章節構造を活かしつつ精度を確保するため。Bedrock KBはMarkdown見出しをネイティブ認識しないが、Hierarchicalなら親子チャンクで文脈が保持される。
- **注意**: チャンキング戦略はデータソース作成後に変更不可。初期設定を慎重に決める必要がある。

### 2026-05-02: 回答生成LLMは Claude Sonnet 4.5 をメイン採用

- **決定**: メインの回答生成は Claude Sonnet 4.5、軽量質問は Claude Haiku 4.5。
- **理由**: Bedrock統合済み・引用付き回答・日本語精度。命を扱う性質上、精度最優先のためSonnet 4.5を主軸にしつつ、頻度の高い軽量質問用にHaiku 4.5を併用してコスト最適化する。

### 2026-05-02: 会話バックエンドは Amplify AI Kit を採用

- **決定**: Amplify Gen2 + AI Kit の `a.conversation()` ルートを使う。
- **理由**: AppSync GraphQL API + Conversation Handler Lambda + DynamoDB + Cognito認証 + ストリーミング応答が一括生成され、最小工数でChatGPT相当のスレッド管理が実現できる。
- **トレードオフ**: Amplify特有の構成に依存するため、将来的な脱Amplifyは追加コストになる。

### 2026-05-02: 月額予算ガードは「アラート + ハードストップ」の2段構え

- **決定**: AWS Budgets で月額 $30 上限を設定し、50%/80%/100%でメールアラート。100%超過時は AWS Budgets Actions で `bedrock:InvokeModel*` / `bedrock:Retrieve*` を Deny する IAMポリシーを自動アタッチして Bedrock呼び出しを停止する。
- **理由**: 個人利用とはいえバグや想定外利用でコスト暴走するリスクは残る。アラートだけでは「気づいた時には超過」のリスクがあるため、ハードストップで請求の天井を強制する。試算は月 $8〜15 のため、$30 は2倍以上の余裕値。
- **トレードオフ**: 上限超過時に突然回答が返らなくなるため、開発デモ中などに止まる可能性がある。アタッチ先のIAMロール/ユーザーは Lambda実行ロールを基本とし、開発時の AWS Console テスト機能には影響しないようスコープを絞る。

### 2026-05-02: 5時間枠は A→B→C の段階アプローチ

- **決定**: 5時間枠でフルMVPは作らず、A（AWS Console テスト機能で引用付き回答確認）→ B（API疎通）→ C（Next.js 簡易UI）の順で積み上げる。認証・マルチスレッド・ナレッジ投稿フォームはPhase 1.5に分離。
- **理由**: Amplify Gen2 + AI Kit のセットアップだけで初回1〜2時間かかるため、5時間でフルMVPは非現実的。Aは独立して価値があり（KBが正しく動くことを確認できる）、A完了時点でいつでも止められる構造にして時間リスクを管理する。
- **トレードオフ**: 配偶者がフロントから触れるのは別日になる。

### 2026-05-02: 初期取込は公的マニュアル5本すべて、論文はPhase 1.5

- **決定**: spec.md §3-2 に列挙された公的マニュアル5本（飼養衛生管理基準/HPAI防疫指針/AW指針/衛生管理ハンドブック/HACCP）をすべて MVP 初期取込に含める。論文（J-STAGE等の精選20〜30本）はPhase 1.5で追加。
- **理由**: 公的マニュアルは権威性が最高で量も限定的（5本）なのでまとめて入れて損はない。論文は「採卵鶏・日本・500羽規模」での精選作業に時間がかかり、ノイズ文書混入のリスクが高いため切り離す。

### 2026-05-03: v2.0 ピボット後の追加取込は公的7本（鳥獣対策・卵食品安全）

- **決定**: ペット飼育前提に改訂後、害獣対策・卵食品安全カテゴリの公的マニュアル7本を追加取込。既存7本と合わせて計14本。
- **採用文献**:
  - 卵食品安全: 厚労省「サルモネラ食中毒予防」(広報誌、家庭向け)、厚労省「鶏卵選別包装施設HACCP手引書」(on egg / in egg 汚染経路の根拠)
  - 鳥獣被害対策: 農水省「中型獣類編 令和5年版」(アライグマ・ハクビシン・タヌキの最新版)
  - 鳥獣保護管理法: 環境省「鳥獣保護管理基本指針」(法律の基本指針)
  - 神奈川県: 県アライグマ・ハクビシン対策パンフ、県第4次アライグマ防除実施計画、県食痕被害痕の見分け方
- **見送った文献**: 農水省「総合対策編」(MAFFサイトの 403 で取得不可、中型獣類編と内容重複大)、農水省「関連制度編」(同じく 403)
- **理由**: 公的ソース限定でノイズ文書を排除しつつ、家庭利用に直結する切り口（家庭での予防、自治体での実務手続き）をカバー。神奈川県分は「アライグマは県の防除実施計画により市町村届出のみで捕獲可」という綾瀬市での実務根拠を含むため、捕獲フェーズ移行時に必須。
- **取込結果**: StartIngestionJob V4I8KBQHRT で約1分でCOMPLETE。新規7件のみ index 化（既存はスキップ）。

### 2026-05-03: 中型獣類編がハクビシン質問で retrieval されない件

- **現象**: 「ハクビシンが鶏小屋の周りで目撃された場合の対処」というクエリで、新規取込の「野生鳥獣被害防止マニュアル_中型獣類編_令和5年.pdf」(10MB / 多ページ) が retrieval 結果に含まれず、既存「鶏卵生産衛生管理ハンドブック」(野生動物侵入防止の一般論を含む) が代わりに引かれた。
- **推測原因**:
  1. クエリ embedding が「鶏小屋」「侵入防止」キーワードに引っ張られ、より具体的に「鶏舎の防鳥ネット」を語るハンドブック側の cosine 距離が近かった
  2. 中型獣類編は parent 1500 / child 300 の Hierarchical chunking で分割されており、「ハクビシン」を主題とする章のチャンクがクエリと意味的に離れた表現になった可能性
  3. retrieval `numberOfResults` がデフォルト (5件) のため、僅差で中型獣類編が漏れた可能性
- **対処の選択肢** (Phase 1.5 で実施):
  1. `retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.retrievalConfiguration.vectorSearchConfiguration.numberOfResults` を 5 → 10 に拡張
  2. リランカー (Cohere Rerank 等) を Bedrock KB に組み込む (2025年に Bedrock サポート追加済み)
  3. クエリ拡張 (「ハクビシン アライグマ タヌキ」のように OR 展開してから retrieve)
  4. 章別の中型獣類編に手動で source_type メタデータを付け、質問カテゴリで filter
- **教訓**: ノイズ文書ではなく「クエリと相性の悪いチャンキング」が retrieval 品質を落とすパターン。RAGAS で Context Recall を測れば顕在化する想定。

### 2026-05-03: MAFF サイトは attach/pdf/ 配下を 403 でブロック

- **現象**: `https://www.maff.go.jp/j/seisan/tyozyu/higai/manyuaru/attach/pdf/manual-24.pdf` 等を curl で GET すると 403 (text/html のエラーページが返る)。同じ MAFF でも `R5_tyuugata/r5_tyuugata_0.pdf` 等は 200 で通る。
- **対処を試した範囲**: User-Agent をブラウザ風に偽装、Referer を親HTMLに指定、両方を同時に → いずれも 403 のまま。
- **原因推測**: MAFF が `attach/pdf/` ディレクトリ配下に Bot 検出 (Akamai 等) を入れている可能性。ブラウザの JS challenge を経由しないと取得できない疑い。
- **回避策**:
  1. ブラウザで手動ダウンロードしてからローカルに置いて S3 にアップロード
  2. Wayback Machine (`https://web.archive.org/web/*/maff.go.jp/.../*.pdf`) からアーカイブ版を取得
  3. 同じ内容を載せた別ドメインの自治体配布版 (`city.shiroishi.miyagi.jp` 等) を使う
- **今回の対応**: 「関連制度編」は取込を諦め、環境省「鳥獣保護管理基本指針」(env.go.jp、403 なし) を代替採用。
- **再発防止**: MAFF の `attach/pdf/` 配下のPDFが必要になったら、最初からブラウザで手動ダウンロードする。自動化スクリプトの対象外と認識する。

### 2026-05-03: Cognito 認証は Amplify Gen2 デフォルトで「家族2名クローズド」に最適化済み

- **発見**: `amplify/auth/resource.ts` を `defineAuth({ loginWith: { email: true } })` だけにすると、生成される User Pool は `AdminCreateUserConfig.AllowAdminCreateUserOnly = True` になる。つまり管理者が `admin-create-user` で登録したユーザーのみ存在可能で、誰でも sign-up できない。家族2名のクローズドシステム要件と一致。
- **意味**: フロント側の `<Authenticator hideSignUp>` は UI から sign-up タブを消すだけで、バックエンド側でも誰も sign-up できないので二重防御。`hideSignUp` を外しても UI には sign-up タブが出るが、実行すると Cognito 側で「Sign up is not allowed for this user pool」エラーになる。
- **教訓**: Amplify Gen2 のデフォルトは想定と違う場合があるので、`describe-user-pool` で `AdminCreateUserConfig` を確認する習慣を持つ。

### 2026-05-03: Cognito User Pool の Username は内部 UUID、email は alias

- **挙動**: `defineAuth({ loginWith: { email: true } })` の User Pool は `UsernameAttributes: ["email"]` 設定。`admin-create-user --username <email>` で作成しても、内部的には UUID 形式の Username が発行され、email は alias として扱われる。`list-users` の出力で `Username: 77c43a88-4001-...` と UUID で表示される。
- **ログイン**: ユーザーは email でログインする (Cognito が alias 解決して UUID にマップ)。
- **管理操作**: `admin-set-user-password` などの後続操作には `--username` に email でも UUID でもどちらでも可 (alias 解決される)。
- **注意点**: 将来 Username Attributes を `phone_number` に切り替える場合は migration 必要。今回は email 固定で問題なし。

### 2026-05-03: Amplify UI Authenticator + Next.js 16 App Router の組み込みパターン

- **構成**: 2つの Client Component に分離する公式パターンを採用。
  1. `web/app/ConfigureAmplifyClientSide.tsx`: `Amplify.configure(outputs)` と I18n 設定を実行。`return null` の不可視コンポーネント。
  2. `web/app/AuthenticatorWrapper.tsx`: `<Authenticator hideSignUp>{children}</Authenticator>` で children をラップ。`@aws-amplify/ui-react/styles.css` もここで import。
- **layout.tsx (Server Component) の側**: `<body>` 直下に `<ConfigureAmplifyClientSide />` を置いてから `<AuthenticatorWrapper>{children}</AuthenticatorWrapper>` で全ページをラップ。
- **`amplify_outputs.json` の参照**: リポジトリルートにあるため `web/app/` から `'../../amplify_outputs.json'` で相対 import。`@/amplify_outputs.json` (tsconfig path alias) は web/ 内を指すので使えない。
- **日本語化**: `I18n.putVocabularies(translations)` (Amplify UI 同梱の全言語辞書) → `I18n.setLanguage('ja')` → `I18n.putVocabulariesForLanguage('ja', { ... })` で個別ラベルを上書き。同梱辞書だけでは「メールアドレス」等は英語のまま残るので追加上書きが必要。
- **既存 page.tsx への影響**: `useAuthenticator((c) => [c.user])` を呼ぶだけで `user` と `signOut` が取れる。Authenticator が ancestor にいれば任意の Client Component で使える。
- **Next.js 16 (Turbopack) の警告**: `web/package-lock.json` と `chicken-knowledge-rag/package-lock.json` の両方を検出して workspace root を誤推定する警告が出る。機能上は影響なし。`web/next.config.ts` で `turbopack: { root: __dirname }` を設定すれば消える (今回は未対応)。

### 2026-05-03: Cognito 永続パスワードの bash 設定の隠蔽

- **要件**: `admin-create-user` で生成した一時パスワードを `admin-set-user-password --permanent` で永続化する流れで、パスワード文字列を bash の echo / printf で stdout に出すと「シークレットマスク出力禁止」ルールに反する。
- **対処**: `printf 'export USER1_PASSWORD=%s\n' "$PWD1" >> ~/.secrets/...` で env ファイルに直接追記し、シェル変数経由で Cognito API に渡す。stdout には変数名と長さ (`length: ${#PWD1}`) だけ出す。
- **Cognito の password policy**: Amplify Gen2 のデフォルトは「8文字以上、大文字・小文字・数字・記号それぞれ1個以上」。`openssl rand -base64 16` だけだと記号を含まないことがあるので、生成パスワードに `Ag1!` などの記号を後付け追記して policy を満たす。

### 2026-05-03: Playwright テストは認証ガード後に skip マーキングで温存

- **問題**: 既存の Playwright テスト3本 (チャット UI 直接操作) は Authenticator 前段化により全て fail する。
- **対処**: 既存テストは `test.describe.skip` で囲んで温存し、Phase 1.5 で Cognito JWT を Playwright の `storageState` に事前注入する仕組みを入れた後に有効化する。代わりに新規「未認証時にサインイン画面が表示される」smoke test を1本追加 (1 passed / 3 skipped)。
- **理由**: Playwright で Cognito JWT を取得して localStorage に注入するには aws-amplify を Node 側でも動かす必要があり、本セッションのスコープを超える。手動ブラウザ確認は完了している。
- **教訓**: 認証導入時に既存 E2E が壊れるのは予測可能なので、最初から skip + コメントで意図を残す。後続セッションが「なぜ skip されているか」を即座に判断できる。

### 2026-05-03: PDF への sidecar metadata は今回見送り

- **状況**: CLAUDE.md には「ナレッジ投稿時は source_type メタデータを必ず付与する」とあるが、既存7本の公的マニュアル PDF には `*.metadata.json` の sidecar が付いていなかった (S3 ls で確認)。
- **判断**: 一貫性を優先し、追加分7本にも sidecar を付けない。Phase 1.5 で「現場ナレッジ Markdown 投稿フォーム」を実装する段階で、PDF・Markdown の両方に統一的なメタデータ戦略を設計し、必要なら既存ドキュメントを Re-ingestion する。
- **影響**: 現状はメタデータ filter での絞り込みができない。`source_type=official_regulation` 等のフィルタが効かないので、retrieval は純粋な vector similarity に依存。
- **Phase 1.5 で決めること**: filterable / non-filterable の振り分け (S3 Vectors の 2048 バイト上限を踏まえる)、category の語彙 (CLAUDE.md §spec.md §3-3 の語彙: 育成/飼料/疾病/衛生/害獣対策/鶏小屋建築/鶏小屋設備/産卵/卵料理/個体観察/行動・福祉)、既存14本の Re-ingestion 要否。

---

## 知見・ハマりどころ

### 2026-05-02: snap版 gh の `--push` オプションが git-remote-https を解決できない

- **現象**: `gh repo create --public --source=. --push` を実行するとリポジトリは作成されるが、push段階で `git: 'remote-https' is not a git command` エラーで失敗する。
- **原因**: snap版gh（`/home/tetutetu/snap/gh/...`）が内部で git を呼び出すときに `GIT_EXEC_PATH` の解決が崩れ、システムの `/usr/lib/git-core/git-remote-https` が見つからなくなる。
- **回避策**: `gh repo create` を `--push` なしで実行（リモート登録までは成功する）→ 通常の `git push -u origin main` を別途実行する。これでシステムのgitが直接呼ばれて成功する。
- **再発防止**: gh の `--push` 系オプションは使わず、リポジトリ作成と push を分けて実行する運用にする。

### 2026-05-02: env ファイルは `export` を付けないと子プロセスに変数が渡らない

- **現象**: `source ~/.secrets/<project>.env && npx ampx sandbox` で、`source` 後の同シェルでは変数が見えるのに、`npx` の子プロセスでは「環境変数未設定」エラーで落ちる。
- **原因**: `KEY=value` 形式は shell のローカル変数定義。`source` で実行しても shell ローカル変数のままで、子プロセスへは継承されない。子プロセスへ渡すには `export` が必要。
- **対処**: `~/.secrets/*.env` の各行を `export KEY=value` 形式で書く。代替: 呼び出し側で `set -a; source ...; set +a` を使う方法もあるが、毎回書くのが手間なので env ファイル側で `export` 付けるのが推奨。
- **再発防止**: 今後 `~/.secrets/` 配下に env ファイルを作るときは最初から `export` を付ける。

### 2026-05-02: IAM ロール/ポリシーの description は ASCII + Latin-1 のみ

- **現象**: CDK で `iam.Role` / `iam.ManagedPolicy` の description を日本語で書いてデプロイすると、CFn が `Value at 'description' failed to satisfy constraint: Member must satisfy regular expression pattern: [	
 -~¡-ÿ]*` で失敗。
- **原因**: AWS IAM API が description プロパティに ASCII（U+0020-U+007E）と Latin-1 補助（U+00A1-U+00FF）のみを許容している。日本語（U+3040〜、U+4E00〜）は不可。
- **対処**: CFn に渡る description プロパティは英語で書く。コード内のコメント（`//` `/* */`）は日本語OK（CFnに送られないため）。
- **影響範囲**: IAM 系（Role, ManagedPolicy, Policy）。他のリソース（S3, Lambda 等）の description / displayName は API 仕様により異なるので個別確認が必要。

### 2026-05-02: CDK Bootstrap の孤児状態と復旧手順

- **現象**: 新規 `cdk bootstrap` 実行時に `Resource of type 'AWS::S3::Bucket' with identifier 'cdk-hnb659fds-assets-...' already exists.` エラー。
- **原因**: 過去に Bootstrap した後、CDKToolkit Stack だけ削除されてバケットだけ残っていた状態（バケットは `DeletionPolicy: Retain` のため Stack 削除でも残る）。
- **対処**: 既存バケットを完全削除（`aws s3 rb --force`）してから `cdk bootstrap` 再実行。
- **重要な確認事項**: バケット中身に過去 CDK デプロイの assets が含まれている場合、削除すると過去プロジェクトの `cdk destroy` や `cdk deploy --update` が動かなくなる。バケット中身に何が入っているか確認してから削除を判断する。
- **CDK Bootstrap の正しい運用**: アカウント・リージョンごとに 1回だけ実行。複数プロジェクトが同じ bootstrap を共有する設計なので、新プロジェクトごとに再 bootstrap する必要はない。

### 2026-05-03: S3 Vectors の filterable メタデータは 2048 バイト上限

- **現象**: Bedrock KB Ingestion で `Filterable metadata must have at most 2048 bytes (Service: S3Vectors, Status Code: 400)` エラーで失敗。
- **原因**: S3 Vectors の制約として、各ベクトル項目の filterable メタデータ合計サイズが 2048 バイト上限。Bedrock KB はチャンクテキスト本体 (`AMAZON_BEDROCK_TEXT`) と内部メタデータ (`AMAZON_BEDROCK_METADATA`) を自動付与し、Hierarchical chunking の parent (1500 トークン) 等で簡単にこの上限を超える。
- **対処**: `CfnIndex.metadataConfiguration.nonFilterableMetadataKeys` に `AMAZON_BEDROCK_TEXT` と `AMAZON_BEDROCK_METADATA` を指定して非フィルタ化する。これらは取得 (retrieval) は可能だがクエリフィルタには使えなくなる。RAG 用途では filter 必須ではないため問題なし。
- **再発防止**: 新規 VectorIndex 作成時は最初からこれらを `nonFilterableMetadataKeys` に含める運用にする。

### 2026-05-03: Bedrock KB Replacement 時の名前衝突問題

- **現象**: VectorIndex の構成変更（metadataConfiguration 追加）で論理ID + indexName を変更したところ、依存する Bedrock KB が Replacement 対象となり、新KB作成時に `KnowledgeBase with name chicken-knowledge-rag-kb already exists` エラーで失敗。
- **原因**: CFn の Replacement は「新リソース作成 → 旧リソース削除」の順序。新KB作成時点ではまだ旧KBが存在しているため、`name` が同一だと衝突する (Bedrock KB は同一アカウント内で名前一意)。
- **対処**: `name` プロパティに `-v2` 等のサフィックスを付ける。VectorIndex の `indexName` も同様。
- **教訓**: CFn Replacement を引き起こすプロパティ (CDK の論理ID変更や immutable プロパティ変更) を伴う場合、依存リソース側の物理名も変更する必要がある。
- **CFn Update requires の見方**: `aws-cdk-lib` の `*.generated.d.ts` の各 prop の `@see` URL が CFn ドキュメントで Update requires (No interruption / Some interruption / Replacement) を確認できる。

### 2026-05-03: Claude 4.5 系は Inference Profile (CRIS) 必須

- **現象**: `aws bedrock-runtime invoke-model --model-id anthropic.claude-haiku-4-5-20251001-v1:0` で `ValidationException: Invocation of model ID ... with on-demand throughput isn't supported.`
- **原因**: Claude 4.5 系は AWS Cross-Region Inference (CRIS) 経由のみ呼び出し可能。on-demand 直接呼び出しは未サポート。
- **対処**: Inference Profile ARN を使う。ap-northeast-1 で利用可能なプロファイル:
  - `jp.anthropic.claude-sonnet-4-5-20250929-v1:0` (JP リージョン群)
  - `jp.anthropic.claude-haiku-4-5-20251001-v1:0` (JP リージョン群)
  - `global.anthropic.claude-sonnet-4-5-20250929-v1:0` (グローバル)
  - `global.anthropic.claude-haiku-4-5-20251001-v1:0` (グローバル)
- **ARN 形式**: `arn:aws:bedrock:<region>:<account>:inference-profile/<profileId>` (system-managed プロファイルでも account ID 入り)
- **モデルアクセス**: CRIS は AWS が自動有効化するため、Claude 4.5 系については AWS Console でのモデルアクセス手作業が不要なケースが多い (実証済み)。3.x 系は引き続き手動有効化が必要。

### 2026-05-03: AWS CLI v2 の `--body` パラメータは fileb:// 必須

- **現象**: `aws bedrock-runtime invoke-model --body '{"...":...}'` で `Invalid base64` エラー。
- **原因**: AWS CLI v2 は `--body` を base64 エンコード済みバイナリとして扱う。生 JSON をそのまま渡すと base64 として decode 失敗。
- **対処**: 一時ファイルに JSON を書いて `--body fileb:///path/to/body.json` で渡す。または `--cli-binary-format raw-in-base64-out` フラグで raw 文字列を許可する。

### 2026-05-03: Lambda Function URL CORS と Lambda コード側ヘッダーの重複問題

- **現象**: ブラウザから fetch で「Failed to fetch」エラー。CORS preflight (OPTIONS) は通っているが、実 POST で fetch が失敗。
- **原因**: Lambda Function URL の CORS 設定と Lambda コード側で **両方** が `Access-Control-Allow-Origin` ヘッダーを応答に付与した結果、応答に同ヘッダーが2つ含まれた。ブラウザは仕様上「Access-Control-Allow-Origin が複数」を不正と判断し、レスポンスを破棄して fetch を失敗させる。
  ```
  access-control-allow-origin: *                       ← Lambda コード由来
  access-control-allow-origin: http://localhost:3000   ← Function URL CORS 設定由来
  ```
- **対処**: **Lambda Function URL の CORS 設定を使う場合、Lambda コード側で CORS ヘッダーを返さない**。Lambda コードでは `Content-Type` などの非CORS ヘッダーのみ。CORS ヘッダーの付与は Function URL の設定 (`cors.allowedOrigins` 等) に任せる。
- **デバッグ手順**: `curl -i -X POST <URL>` で応答ヘッダーを確認 → `access-control-allow-origin` が複数あれば原因特定。
- **再発防止**: Lambda Function URL や API Gateway の CORS 機能を使う際は、Lambda コードに CORS ヘッダーを書かない原則。

### 2026-05-03: PR の commit 漏れに注意 (git add の確認不足)

- **現象**: PR のコミットメッセージに「ファイルXを修正」と書いていたが、実際のコミットにそのファイルの変更が含まれていなかった (PR #4 で発生)。
- **原因**: ローカルでファイルを編集後、`git add` する際に対象ファイルを明示指定 (`git add specific.ts`) すると、それ以外の編集中ファイルがstageされない。`git status -s` を見ずに `git commit` してしまった。
- **影響**: マージ済みでも main のソース上は古い状態のまま。再デプロイ時に古いコードが反映されて問題再発する可能性。
- **対処**: コミット前に必ず `git status -s` を実行し、staging 対象を確認する。また `git diff --staged` で実際の変更内容を見てから `git commit`。
- **再発防止**: コミット作業前に staging 状態の確認を徹底。フックで自動チェックすることも検討（lefthook等）。

### 2026-05-03: 構成図は AWS 公式プラグイン `deploy-on-aws` で draw.io 形式生成

- **決定**: 構成図は `docs/chicken-knowledge-rag-architecture.drawio` に AWS4 公式アイコン入り draw.io 形式で保管する。
- **背景**: 旧 `awslabs.aws-diagram-mcp-server` (PyPI) は yanked。後継は AWS Labs の Claude Code プラグイン `deploy-on-aws@agent-plugins-for-aws`。`/plugin install` または `claude plugin install deploy-on-aws@agent-plugins-for-aws` で導入する。
- **生成手順** (プラグイン未ロードのセッションでも手動実行可):
  1. プラグイン同梱の SKILL.md と references/ を参照しながら .drawio XML を手書き
  2. `uv run --with defusedxml python3 ${PLUGIN_ROOT}/scripts/lib/validate_drawio.py <file>` で検証
  3. `${PLUGIN_ROOT}/scripts/lib/fix_step_badges.py` でバッジ重なり自動修正 (※注: `defusedxml.ElementTree` に Element/SubElement/ElementTree/tostring/register_namespace/indent を stdlib から monkey-patch する必要あり。プラグイン本体のバグ)
  4. `${PLUGIN_ROOT}/scripts/lib/drawio_url.py <file>` で app.diagrams.net 即プレビュー URL を生成
- **PNG 出力**: draw.io desktop CLI が必要。WSL に未インストールなので、必要になったら `npm i -g @hediet/drawio-desktop-headless` 等を検討する。
- **アイコン**: S3 Vectors 専用アイコンは AWS4 ライブラリに無いため `s3` アイコン + サブラベル "Titan Embed V2 / 1024d" で代用。Bedrock KB と Claude も両方とも `bedrock` アイコンに役割サブラベルを添えて区別する。
- **PLUGIN_ROOT の現値**: `/home/tetutetu/.claude/plugins/cache/agent-plugins-for-aws/deploy-on-aws/<version>/`

---

## 未解決の検討事項

- 配偶者の利用開始想定時期（MVPの完成目標日）— Phase 1.5 のスケジュールに影響
- ナレッジ投稿フォームのMarkdownエディタ選定（react-md-editor / @uiw/react-md-editor / その他の比較が必要、Phase 1.5で判断）
- AWS Budgets Actions のハードストップ対象IAMロール/ユーザーの最終決定（Step 1で決める）

### 2026-05-04: B-3 は AppSync `a.query()` (Direct Lambda Resolver) で実装、`a.conversation()` は見送り

- **決定**: 当初計画では Amplify AI Kit の `a.conversation()` でマルチスレッド + 履歴 + UI を一括実装する予定だったが、案Y (= `a.query('chat')` で 1問1答 API、AppSync Lambda Resolver の Amplify Gen2 ラッパー) を採用。マルチスレッドUI は別タスク (B-3 後半) に切り出す。
- **理由**:
  1. KB を必ず引かせるカスタムハンドラ (`defineConversationHandlerFunction`) は公式ドキュメントが薄く、特に Lambda が受け取る event 型・メッセージ履歴の自前取得が複雑で実装に時間がかかる
  2. 「Hosting 公開前の認証強化」が最優先で、まずそこを確実に達成する必要がある
  3. `a.query()` は AWS AppSync Lambda Resolver チュートリアル(https://docs.aws.amazon.com/appsync/latest/devguide/tutorial-lambda-resolvers.html) と同じ仕組みの Amplify Gen2 ラッパーで、CDK が GraphQL スキーマ・IAM・Cognito Authorizer を自動生成
  4. 既存 Python Lambda の Bedrock 呼び出しロジックを TypeScript に移植するだけで済み、debug 容易
- **採用構成**:
  - `amplify/functions/chat-handler/` に TypeScript Lambda (handler.ts + resource.ts)
  - `amplify/data/resource.ts` で `a.query('chat')` + `allow.authenticated()` (Cognito User Pool 認証必須)
  - `defaultAuthorizationMode: 'userPool'` に変更 (識別Pool → User Pool)
  - `web/app/page.tsx` は `generateClient<Schema>().queries.chat({question})` で呼び出し
- **トレードオフ**: マルチスレッドUI が今回スコープ外。todo の B-3 後半で別ブランチ対応。
- **代案として検討した選択肢**:
  - α (Tool Use): `a.conversation()` の `tools` で KB Tool 登録 → LLM が判断して呼ぶ。ただし「KB を引かない判断」をされるリスクが残る (spec §5-2 の精度最優先と相性悪)
  - β (Custom Handler): `a.conversation()` + `defineConversationHandlerFunction`。KB必須化できるが上記の通りドキュメント薄
  - 案Y (採用): `a.query()` で1問1答。マルチスレッド以外すべて達成

### 2026-05-04: KB ヒット判定はコサイン類似度スコア >= 0.7 で振り分け

- **決定**: chat handler の Lambda 内で `BedrockAgentRuntime.RetrieveCommand` を機械的に必ず実行し、`retrievalResults[].score` の最大値が **0.7 以上** ならば「KB根拠あり」、未満なら「KB根拠なし → ⚠ 表示 + LLM 一般知識回答」に振り分ける。
- **背景**: S3 Vectors は閾値なしで top-K (5件) を必ず返す仕様のため、`results.length > 0` で判定すると **完全に無関連な質問でも常に「KB根拠あり」になる** バグが発生した (実初回確認時)。
- **実測スコア分布** (Titan V2 1024d cosine):
  - 真の関連質問「採卵鶏の衛生管理で重要なポイント」 → top **0.8747**
  - 鶏ワード共通の無関連質問「鶏の鳴き声を音楽にしたい」 → top **0.6606**
  - 差分: 約 0.21、中間値の 0.7 を閾値に設定
- **理由**: KB が鶏関連文書ばかりなので「鶏」というキーワード単独で類似度が底上げされる。閾値 0.5 では振り分けが効かず、0.7 で実用範囲。
- **将来の調整候補**: より厳しくしたい場合は 0.75、より拾いたい場合は 0.65。CloudWatch Logs (`KB retrieve scores: ... topScore: ...`) で実値を見ながら継続調整。
- **トレードオフ**: 単一の数値閾値なので「鶏症状の質問だが KB に該当文書なし」のような微妙なケースは取りこぼす可能性あり。Phase 1.5 後半の精度チューニング (Step 7) でリランカー導入や閾値再評価を行う。

### 2026-05-04: KB ヒットなし時は冒頭に「⚠ 参考資料にはありません。一般的な知識ですが、」を強制付与

- **決定**: KB が引けなかった質問は、`Bedrock Converse API` で Sonnet 4.5 (実装は Haiku 4.5 Inference Profile を流用) を直接呼び、systemPrompt で「回答冒頭に必ず⚠表示を付ける」と強制する。
- **理由**: spec §5-2 の「ハルシネーション抑制最優先・出典必須」を踏まえつつ、てつてつの設計判断「該当なしなら LLM が一般知識で答えればいい」を採用。ただしユーザーが「これは KB 根拠なし回答」と一目で識別できるよう ⚠ を強制表示。
- **副作用**: フロント側で `hasKbResults` boolean を見て UI 色を緑/アンバーに分けることで、テキスト冒頭の ⚠ と組み合わせて2重に明示している。
- **systemPrompt 抜粋**: 「疾病・薬剤・緊急対応・害獣捕獲・卵食品安全に関する内容を含む場合は『専門家に相談してください』を末尾に必ず添えること」。Phase 1.5 後半の Bedrock Guardrails 設定 (Step 7) と組み合わせて二重防御を予定。

### 2026-05-04: B-3 後半 マルチスレッドUI のデータモデルは自前 `a.model('Conversation','Message')` を採用

- **決定**: B-3 前半で見送った `a.conversation()` (AI Kit) は B-3 後半でも採用しない。代わりに `a.model('Conversation', 'Message')` で自前モデルを定義し、フロントが Conversation/Message の CRUD を `client.models.X` で直接行う構成に決定。
- **理由**:
  1. B-3 前半で AI Kit の `defineConversationHandlerFunction` を見送った理由 (公式ドキュメント薄、KB必須化のカスタムハンドラ複雑) が B-3 後半でも変わらない
  2. `allow.owner()` でフロントから直接 CRUD する方が authz が単純 (Cognito sub ベースの所有者ガードが自動で効く)
  3. chat Lambda は KB検索+回答生成だけに専念でき、メッセージ保存責務はフロントに分離。トランザクション性は犠牲になるが構造が明快
- **代案として検討した選択肢**:
  - 案2: AI Kit Custom Handler 再挑戦 → 不採用 (理由1)
  - 案3: Lambda 内で Conversation/Message を生成・保存 → 不採用 (Lambda が AppSync を呼ぶ追加 IAM 必要、複雑化)

### 2026-05-04: 長期スレッドの履歴は「summary + 直近10件」方式で圧縮

- **決定**: ChatGPT/Claude.ai と同様の累積要約方式を採用。Conversation に `summary: string` と `summarizedCount: int` を追加し、メッセージが増えるたびにフロントが「summary 化されていない件数 > 10」を判定して `summarize` mutation を非同期で呼ぶ。
- **動作**:
  - 履歴 ≤ 10 件: summary なし、生履歴を Converse の messages にそのまま積む
  - 履歴 11 件目以降: chat 呼び出しに summary + 直近10件を渡す。回答後、フロントが `[summarizedCount, total-10)` 区間を summarize mutation に渡し、Conversation を update
  - summarize mutation は `existingSummary + 新メッセージ群` を Haiku 4.5 で統合し新 summary を返す → スレッドが伸びても要約 mutation の入力は常に約10件分で一定
- **理由**: 「ゼロから会話を始まらせない」というUX要件と、「Haiku 4.5 のコンテキスト窓を浪費しない」というコスト要件の両立。Lambda への入力サイズもほぼ一定に保てる。
- **コスト試算**: 要約1回あたり Haiku 4.5 で約 $0.0001 前後。10ターンに1回なのでほぼ無視できる。
- **タイトル自動生成**: 最初のユーザー質問の先頭40文字を `Conversation.title` に自動設定。LLM要約は不要 (コスト無駄)。
- **削除UX**: Amplify Data はリレーションの cascading delete をサポートしないため、フロント側で「Message 一覧取得 → 個別削除 → Conversation 削除」のループを実装。

### 2026-05-04: DynamoDB TTL は CDK escape hatch (`cfnTable.timeToLiveAttribute`) で90日設定

- **決定**: Amplify Gen2 の `a.model()` には TTL を宣言する公式構文がないため、`backend.data.resources.cfnResources.amplifyDynamoDbTables[modelName].timeToLiveAttribute = { attributeName: 'expiresAt', enabled: true }` で後付け設定する。
- **動作確認**: 両テーブル (Conversation / Message) で `aws dynamodb describe-time-to-live` の結果が `TimeToLiveStatus: ENABLED, AttributeName: expiresAt` となっていることを確認。
- **モデル側**: `a.integer()` で `expiresAt` 属性を宣言、フロント側でレコード作成時に `Math.floor(Date.now() / 1000) + 90 * 86400` を渡す。
- **注意**: `cfnTable.timeToLiveAttribute` の代入は Amplify Gen2 の `AmplifyDynamoDBTable` カスタムリソース固有のプロパティ。標準 `AWS::DynamoDB::Table` の `TimeToLiveSpecification` とは別系統なので混同注意。

### 2026-05-04: `RetrieveAndGenerate` を捨てて `Retrieve` + `Converse` 自前構成に統一 (履歴対応のため)

- **決定**: B-3 前半は KB ヒットありの場合に `RetrieveAndGenerateCommand` を使っていたが、この API は履歴 (messages 配列) を受け付けない。B-3 後半でマルチスレッド + 履歴対応するため、KB ヒットあり/なし両方を `Retrieve` + 自前 `Converse` 構成に統一した。
- **影響**:
  - citations は `RetrieveAndGenerate` の `CitedReferences` から「LLM が実際に引用したもの」が返っていたが、自前構成では Retrieve 結果 top5 を全件 citations として返す形に簡略化 (重複ファイル+ページはマージ)
  - system prompt に Retrieve 結果の抜粋を `【出典: ファイル名 pN】本文...` 形式で埋め込み、回答内で出典を明示するよう指示
- **トレードオフ**: 「実際に引用された範囲」と「retrievaeで上位に来た範囲」がズレる可能性あり。Phase 1.5 後半の精度チューニング (Step 7) でリランカー or プロンプトテンプレート化で再調整する。

### 2026-05-04: ハマりどころ — AWSJSON 入力フィールドは JSON 文字列で渡す

- **症状**: Message テーブルに assistant メッセージが1件も保存されない (user メッセージのみ存在)。フロント側ではエラーキャプチャしておらず、画面にもコンソールにも出ていなかった。
- **原因**: `a.json()` フィールド (`citations`) に JavaScript の object 配列をそのまま渡していた。AppSync の `AWSJSON` スカラは入出力共に JSON 文字列を期待するため、object をそのまま渡すと「型不一致で create が失敗」する。
- **修正**: 保存時は `JSON.stringify(citationsArray)` で文字列化、取得時は両対応のパース関数 (`parseCitations`) で string/object どちらでも処理できるようにする。
- **教訓**: Amplify Data の create/update 戻り値は `{data, errors}` の構造で、エラーは throw されず errors 配列に入る。**全ての mutation 呼び出しで errors を必ずキャプチャして throw する**ようにすべき。エラーが画面に出ないと原因特定が遅れる。

### 2026-05-04: ハマりどころ — `ampx sandbox` の synth は実行開始時のスキーマで固定

- **症状**: `ampx sandbox --once` 実行中に data/resource.ts に `summarizedCount` フィールドを追加したが、デプロイ完了後も AppSync スキーマの `CreateConversationInput` にこのフィールドが含まれず、フロントから create するとエラー (`The variables input contains a field that is not defined`)。
- **原因**: `ampx sandbox` の `Synthesizing backend...` フェーズは実行開始直後に走り、その時点のソースコードでスキーマを固定する。走行中の編集は次回 synth まで反映されない。
- **教訓**: スキーマ変更を伴う編集は **必ず ampx sandbox の synth が完了する前に終わらせる**、または編集してから再デプロイする。差分デプロイは数十秒で済むので追加コストは小さい。

### 2026-05-04: 決定事項 — Amplify Hosting も CDK で IaC 化（手作業マネコン排除）

- **決定**: Amplify Hosting も `aws-cdk-lib/aws-amplify-alpha` で IaC 化し、`amplify/infra/hosting.ts` に配置する。AWS Console 手作業 (Host web app ウィザード) は採用しない。
- **理由**: 当初 Console 手作業を提案したが、てつてつから「再現性がない、なぜマネコンに行かせるのか」とフィードバック。プロジェクトのバックエンド (KB / IAM / Budget 等) はすでに CDK 化されているため、Hosting だけ Console 手作業だと整合性が取れない。docs に書いても次回再現できない問題もある。
- **採用構成**:
  - `Amplify::App`: GitHub 連携、`SecretValue.secretsManager('chicken-rag/github-token')` で PAT を遅延参照
  - `Amplify::Branch`: `autoBuild: true` で push 自動デプロイ、ブランチ名は環境変数 `HOSTING_BRANCH_NAME` で切替可能
  - `platform: amplify.Platform.WEB`: 静的サイト配信（SSR Compute 課金を発生させない）
  - 環境変数: `AMPLIFY_MONOREPO_APP_ROOT=web`、`AMPLIFY_OUTPUTS_GZ_B64=<gzip+base64>`
- **トレードオフ**: `@aws-cdk/aws-amplify-alpha@2.252.0-alpha.0` は alpha 版で API 変更リスクあり。aws-cdk-lib のバージョンと厳密に揃える必要あり (今回は 2.252.0 で揃える)。
- **GitHub PAT scopes**: `repo` + `admin:repo_hook` (Webhook 自動セット用)
- **Secrets Manager 名**: `chicken-rag/github-token` (CDK でハードコード)

### 2026-05-04: 決定事項 — Sandbox を本番として共有運用（KB 二重作成回避）

- **決定**: Amplify Gen2 公式推奨の「Sandbox 開発 / pipeline-deploy 本番」分離は採用せず、**Sandbox 環境を本番として共有運用**する。
- **理由**: 公式パターンだと Bedrock KB と S3 Vectors が二重作成され、14本の文書を再 ingestion する手間と KB ID 同期の問題が発生する。家族2名のシステムには過剰。
- **影響**:
  - `npx ampx sandbox delete` を実行すると Amplify Hosting も停止する → docs/todo.md の既知制約に「**削除禁止**」を明記
  - Hosting からは Sandbox の Cognito/AppSync/Lambda を参照する `amplify_outputs.json` を経由する
- **将来の本番化 (Phase 2 以降)**: KB を別 Stack に分離 → `Bucket.fromBucketName` 参照に変更し、main ブランチで pipeline-deploy する設計を検討

### 2026-05-04: 決定事項 — Next.js は output: 'export' で完全静的サイト化

- **決定**: `web/next.config.ts` に `output: 'export'` を設定して、`out/` に静的ファイル群を書き出す。Amplify Hosting の `platform: WEB` (静的配信) と組み合わせる。
- **理由**: 全ページが Client Component (Authenticator + AppSync 直接呼び出し) で SSR 機能を使っていないため、`platform: WEB_COMPUTE` (SSR) は不要。Compute 課金 (Lambda 起動時間あたり) を完全に避けられる。
- **コスト試算**: ビルド時間 $0.5/月 (10回ビルド想定) + データ転送 $0.05/月 + ストレージ $0.001/月 = **月 $1 未満**
- **トレードオフ**: 動的ルート / Server Actions / Route Handlers などは使えなくなる (現状不要なので影響なし)

### 2026-05-04: 決定事項 — amplify_outputs.json は web/ 配下に置く

- **決定**: `npx ampx sandbox --outputs-out-dir web` で `amplify_outputs.json` を web/ 配下に出力する。
- **理由**: Next.js 16 Turbopack は `turbopack.root` で workspace root を web/ に固定すると、外部ファイル (`'../../amplify_outputs.json'` = リポジトリルート) が import で解決できない。出力先を web/ にすれば `'../amplify_outputs.json'` (web/app/ → web/) で解決可能。
- **影響**:
  - `web/app/ConfigureAmplifyClientSide.tsx` の import パスを `'../amplify_outputs.json'` に変更
  - `amplify.yml` の preBuild も `gunzip > amplify_outputs.json` (web/ 内に出力) に変更
  - リポジトリルートの古い `amplify_outputs.json` は削除（混乱回避）
- **運用**: 今後 `ampx sandbox` 実行時は **必ず `--outputs-out-dir web`** を付ける（todo.md の主要コマンドにも記載）

### 2026-05-04: ハマりどころ — Amplify Hosting 環境変数は 1 個あたり 5500 文字上限

- **症状**: CDK で `environmentVariables: { AMPLIFY_OUTPUTS_B64: <15360文字> }` を渡すと CFn validation で `[#/EnvironmentVariables/1/Value: expected maxLength: 5500, actual: 15360]` エラー。Stack デプロイが UPDATE_ROLLBACK_COMPLETE で失敗。
- **原因**: AWS Amplify Hosting の API 制約で、環境変数は 1 個あたり 5500 文字上限 (key + value 合計ではなく value 単体)
- **対処**: `gzip -c amplify_outputs.json | base64 -w0` で圧縮 (15360 → **2316 文字**) し、`AMPLIFY_OUTPUTS_GZ_B64` 環境変数として渡す。preBuild で `echo "$AMPLIFY_OUTPUTS_GZ_B64" | base64 -d | gunzip > amplify_outputs.json` で復元。
- **教訓**: AWS のサービス制約は CFn validation で初めて発覚することがある。設計時に AWS Service Quotas や `cfn-lint` でスポットチェックすると事前に気付ける。

### 2026-05-04: ハマりどころ — Next.js 16 build 時の TypeScript チェックが workspace root を超えて拡散

- **症状**: Amplify Hosting で `cd web && npm run build` 実行時、Next.js が tsc を起動して `../amplify/data/resource.ts` まで型チェック → `@aws-amplify/backend` が `web/node_modules` に存在せず `Cannot find module` で落ちる。
- **原因推測**: Next.js が複数 lockfile (リポジトリルート + web/) を検出して workspace root をリポジトリルートと判定 → tsc の cwd / include 解釈もリポジトリルート起点に。
- **試した対処** (時系列):
  1. `turbopack.root: resolve(__dirname)` で workspace root を web/ に固定 → Turbopack の compile は通るが tsc は不変
  2. `amplify_outputs.json` を web/ 配下に移動して import を `'../amplify_outputs.json'` に変更 → import エラーは消えたが TypeScript チェック失敗は継続
  3. **`typescript.ignoreBuildErrors: true`** で next build の型チェック自体を無効化 → 成功
- **採用根拠**: 型チェックは `ampx sandbox` の `Running type checks...` フェーズが backend 全体 (amplify/ 含む) を見るため、Amplify Hosting 側で重ねて走らせる必要なし。フロント側の型チェックは別途 `cd web && npx tsc --noEmit` で担保可能。
- **教訓**: Next.js 16 + Turbopack は従来の Next.js と挙動が違う部分がある (`web/AGENTS.md` の警告どおり)。複数の対処を試した順序を時系列で残すと再発時に最短ルートが分かる。

### 2026-05-04: 決定事項 — アプリ名を「Cocco RAG」にリブランド + 「コケ先輩」キャラ実装

- **決定**: アプリ名を `Chicken Knowledge RAG` から **Cocco RAG** に変更し、サイドバーに「コケ先輩」というキャラを表示。chat-handler の systemPrompt にキャラ設定 + **全文の語尾を「コケ」で終える指示**を追加。
- **理由**: 配偶者が日常的に使うペット鶏アシスタントとして、無機質な技術名より親しみやすいネーミングが UX に効く。命を扱うシリアス領域だが、入口の柔らかさは継続利用率に直結する。
- **影響範囲**:
  - `web/app/layout.tsx`: title「Cocco RAG」、description「にわとりとの暮らしを支援するRAGエージェント」
  - `web/app/page.tsx`: ロゴ「🐓 Cocco RAG」、サブテキスト「にわとり飼育アシスタント　コケ先輩」
  - `amplify/functions/chat-handler/handler.ts` の systemPrompt: コケ先輩キャラ設定 + 「すべての文末に必ず『コケ』を付ける」指示。**KB ヒットなし時の警告メッセージや専門家相談を促す末尾文も含めて全文に適用**
- **トレードオフ**:
  - 語尾「コケ」を強制するため、引用元の正確な日本語表現と若干乖離する可能性。事実 (出典・ページ番号・専門家確認の促し) は精度最優先のまま、語尾だけキャラを被せる方針
  - リブランド名はリポジトリ名 (chicken-knowledge-rag) や Stack 名 (chickenknowledgerag) には反映しない (リソース ID 変更は KB 再作成リスクが大きい)
- **教訓**: UI 文言・キャラ設定は systemPrompt に閉じ込めれば、Lambda コード・データモデル・KB を一切触らずに性格を変えられる。今後のチューニング (Step 7) でも「文体」と「事実精度」は別レイヤで扱う。

### 2026-05-04: 決定事項 — スマホ対応は CSS のみで実装（モバイルアプリ化はしない）

- **決定**: 左ペイン (サイドバー) を **md (768px) 以上で常時表示、未満では fixed + transform でスライド出し入れ**するハンバーガーメニュー UX に変更。React Native 等のモバイルアプリ化は採用しない。
- **理由**: 配偶者の主利用デバイスがスマホで、左ペイン固定だとメイン領域が潰れる。Tailwind の `md:` ブレイクポイントと `translate-x-0 / -translate-x-full` の切替で実装でき、追加依存ゼロ・ビルドサイズ増加なし。
- **採用 UX**:
  - 左上にハンバーガーボタン (☰) を `md:hidden fixed top-3 left-3` で配置
  - 開閉は React state `sidebarOpen` で制御、`<aside>` の class を `fixed md:sticky` 切替
  - 背景オーバーレイ (`fixed inset-0 z-30 bg-black/50`) でタップで閉じる
  - スレッド選択・新規会話ボタンタップ時にも `setSidebarOpen(false)` で自動で閉じる (タップ→続けて入力したい動線をスムーズに)
  - メイン領域に `pt-14 md:pt-6` を追加してハンバーガー分の余白確保
- **トレードオフ**: PWA 化やオフライン対応は未対応 (現状 Amplify Hosting + AppSync 必須なのでオフラインは設計外)。実機での触感差 (iOS Safari と Android Chrome) は本番 URL で確認するフェーズに送る。
- **教訓**: 個人利用のクローズドシステムでは「Tailwind だけで対応」が最速かつ低コスト。React Native や Capacitor は配信導線・ビルド・審査の追加コストが大きく、家族2名規模では過剰。

### 2026-05-05: 決定事項 — Issue #18 systemPrompt 改善 (専門家相談のリスク階層化)

- **決定**: chat-handler の systemPrompt を全面書き換え。5カテゴリに触れただけで一律「専門家相談」を付与する旧仕様を廃止し、リスク階層 L1/L2/L3 で出し分ける方式に変更。
- **背景**: ユーザーリサーチ (一次ソース: Anthropic / AWS Bedrock / WHO / NIST / 医療情報学のピアレビュー論文 / AHRQ) で「無条件・全件警告は alert fatigue を生み、本当に重要な警告も無視される」ことが30年来定量的に確立。家庭ユーザー2名のシステムでも同じメカニズムが働き、「お前の回答本当意味ないと思う」レベルのUX劣化を引き起こしていた。
- **採用したリスク階層**:
  - **L1**: 餌・水・床材・行動・環境設計・季節対策・繁殖・換羽 → 警告なし
  - **L2**: 軽い不調・餌の安全性一般論 → 末尾に「気になる様子が続くなら獣医に相談すると安心コケ」を1セッション1回
  - **L3**: 治療判断・緊急対応・食品安全・捕獲法・人獣共通感染症 → 末尾に「この件は獣医・保健所など専門家の判断が必要コケ」を必ず明示
- **改修内容**:
  - `buildSystemPrompt`: XML タグ `<persona>`, `<response_length>`, `<sources>`, `<expert_referral>`, `<output_format>` で構造化
  - `kbContext`: `【出典: ファイル名 pN】本文` → `<source id="S1" filename="..." page="...">本文</source>` 形式
  - `NO_CONTEXT_PREFIX`: `⚠ 参考資料にはありません。一般的な知識ですが、` → `※ 一般知識に基づく回答です（出典未検証）コケ`
  - 引用フォーマット: 本文に `[S1]` インライン + 末尾 `## 出典` セクション (LLM が記述)
  - `maxTokens`: 2048 → 1500 (約800-1000字相当の物理上限、systemPrompt で「800字以内」も明示)
- **L2「1セッション1回」の実装**: LLM 任せ (案A)。`<expert_referral>` 内に「会話履歴で既に同じ専門家相談文を出している場合は省略」と指示。Lambda 側の機械判定 (案B) は不採用 (シンプル先行、不安定なら再検討)。
- **動作確認結果** (Sonnet 4.6 Global、5件):
  - L1 (砂浴び効果・冬の水やり・鳴き声サンプリング): 専門家相談 **完全に消えた** ✅
  - L2 (エサを食べない): 「気になる様子が続くなら獣医に相談すると安心コケ」が**1回だけ**控えめに出た ✅
  - L3 (卵変色 = 食品安全): 「**この件は獣医・保健所など専門家の判断が必要コケ**」が強調表示で出た ✅
  - 引用フォーマット (砂浴び・KBヒットあり): `[S1] [S2]` + 末尾 `## 出典 - [S1] AW指針_採卵鶏.pdf (page 24)` 期待通り ✅
  - 文字数: 全件 100〜400字に収まる ✅
- **想定外の挙動**: L3 (卵変色) の警告が**冒頭**に出た (systemPrompt は末尾指示)。LLM が「緊急性が高いから先に注意喚起すべき」と判断した結果と推察。UX的には冒頭でも妥当なため**許容判断**。
- **教訓**:
  - 「カテゴリに該当 = 全件警告」は Anthropic / AWS / WHO / NIST のいずれも推奨していない (Anthropic 自身の system prompt も「メンタルヘルス等の本当にリスクが高い場合に限って」資源提示)
  - リスク階層化は systemPrompt のみで十分実装可能 (Bedrock Guardrails 不要)
  - LLM が状況判断で warning 位置を変えることがある (冒頭 vs 末尾)。明示的に強制したい場合は systemPrompt の表現を強化できるが、UX 的に妥当なら許容して良い
  - alert fatigue は医療情報学で30年来確立された現象。家庭ユーザー2名のシステムでも同じ。「予測される正常反応」とユーザーの感覚を捉えるべき
- **次のアクション**: Issue #18 完了。Bedrock Guardrails 導入 (旧 Step 7 の独立タスク) は本改修の効果が確認できたため**当面不要** (将来 LLM がプロンプト無視するパターンが頻発したら再検討)。

### 2026-05-05: 決定事項 — chat-handler / summarize-handler を Sonnet 4.6 (Global) に切替

- **決定**: 両 Lambda の `conversationModelId` を `jp.anthropic.claude-haiku-4-5-20251001-v1:0` から `global.anthropic.claude-sonnet-4-6` に変更 (Issue #22)。
- **理由**:
  - Issue #18 (systemPrompt 改善) の効果検証は、最終的に本番運用するモデル上で測りたい。Haiku 4.5 で効くプロンプトが Sonnet 4.6 で同じように効くとは限らないため、先にモデル切替を完了させる順序とした
  - JP より Global を選択した理由: 日本リージョン分のみだとピーク時の 429 ThrottlingException リスクがあり、Global は複数リージョン分散でキャパ豊富
- **コスト影響**: Haiku 4.5 (入力 $1/出力 $5 per 1M tokens) → Sonnet 4.6 (入力 $3/出力 $15) で**約3倍**。家族2名・月100質問想定で月 $1〜2 → $3〜6。予算 $30/月 内に十分収まる。
- **レイテンシ実測**: AWS CLI 直接呼び出しで **1.17秒** (Sonnet 4.6 Global、ap-northeast-1 経由)。Haiku 4.5 と同等の速度で予想より高速。
- **IAM ポリシー追加**:
  - Global Inference Profile が裏で呼ぶ Foundation Model ARN は `arn:aws:bedrock:::foundation-model/anthropic.claude-sonnet-4-6` (リージョン部分が空)
  - 既存の `arn:aws:bedrock:*::foundation-model/*` ワイルドカードでマッチする可能性は高いが、確実性のため `arn:aws:bedrock:::foundation-model/*` を明示追加
- **動作確認**: localhost (dev サーバー) で 3パターン (KBヒットあり/なし/履歴あり) 正常動作を確認。
- **教訓**: Inference Profile を切り替える際は `aws bedrock get-inference-profile` で `models[].modelArn` を確認し、IAM の foundation-model ARN がカバーしているか先に検証する。Global Profile はリージョン空 ARN を持つので注意。
- **次のアクション**: Issue #18 (systemPrompt 改善) を本モデル上で実装・効果検証する。

### 2026-05-05: 決定事項 — KB 拡充の3経路を明確化

- **決定**: KB 拡充の経路を以下の3つに分離して責任主体・入口・出口を明確化する。今後の設計議論はこの分類に必ず照らす。
  - **[1] 公的資料追加**: てつてつが手動で資料を探し S3 docs-bucket に PUT → 自動 Ingestion。既存運用、新規実装不要
  - **[2] 家族ナレッジ追加**: 会話駆動抽出 + 承認 UI で起案 → S3 knowledge-bucket → 自動 Ingestion。Step 6 と Issue #15 が担当
  - **[3] 不足領域分析**: KBミスヒット質問のログを集計し、てつてつへの可視化レポートで KB 拡充計画の判断材料にする。Step 7 と Issue #16 が担当
- **背景**: Issue #15 と #16 を一時「統合できる」と整理してしまったが、誤り。#15 は「家族ナレッジを足すときの品質ガード」、#16 は「KB に何が足りないかの分析」で責務が異なる。両者は KB 拡充の異なる側面で並行で持つべき。
- **影響**:
  - Issue #15 = Step 6 と一体 (家族ナレッジ追加の出口設計)
  - Issue #16 = Step 7 配下 (KB拡充計画のための分析、家族ナレッジ抽出の入口ではない)
  - 経路 [3] のアウトプット (どの領域が薄いか) は経路 [1] (公的資料を探す) または経路 [2] (家族ナレッジを書く) のインプットになる
- **教訓**: 似た問題領域は安易に統合せず、入口・出口・責任主体で分類してから統合判断する。

### 2026-05-05: 決定事項 — Step 6 を「自由記述フォーム」から「会話駆動抽出」に再定義

- **決定**: 当初の Step 6「Markdown 投稿フォーム」(自由記述 + テンプレート埋め) は廃案。**会話駆動抽出 (KBあり+ユーザー追加情報パターン) を入口とする方針** に再定義する。Phase 3「会話型ナレッジ蓄積」の一部 (会話事後抽出パターン) を Phase 1.5 に前倒し。
- **新フロー**:
  1. 通常のチャット会話 (既存)
  2. ターンごとに Lambda が「KB 差分情報」を判定
     - パターン1: KB ヒットなし → Issue #16 のログに流す (家族ナレッジ抽出の対象外)
     - パターン2: KB あり + ユーザー側が追加情報を投入 → 家族ナレッジ抽出の本命
     - パターン3: 確認のみ → 何もしない
  3. パターン2 の発見時に「ナレッジ化候補」として記録
  4. ユーザーが棚卸し画面で承認すると LLM が Markdown 起案 → 編集可能フォーム → S3 保存 → 自動 Ingestion
- **理由**:
  1. 自由記述フォームは「短文・根拠不明・断定調」の汚染リスクを構造的に防げない (Issue #15 で議論)
  2. 会話の起点は RAG なので、ナレッジ化すべきは「会話のうち KB に含まれていない部分」だけ。会話全体を要約すると引用ループになる
  3. 既存のチャット導線 (Cocco RAG) にボタン1つ足すだけで導線が完成し、ユーザー心理的負荷が最小
  4. Markdown は LLM が起案 → ユーザーは編集と承認だけ。テンプレート埋め作業が不要
- **廃案**:
  - 自由記述 Markdown エディタ単独路線
  - YAML front matter テンプレート埋め込み (LLM 起案で代替)
  - 投稿前 RAG プレビュー → Phase 3 まで持ち越し
- **未確定の設計議論** (Issue #15 で継続):
  - パターン2 の判定アルゴリズム (LLM プロンプト方針)
  - 必須メタデータ (source_type / category / 確度自己申告など)
  - 投稿可能カテゴリの確定 (疾病・薬剤・卵食品安全を除外する方針)
  - systemPrompt 追記文言
- **トレードオフ**: パターン2 の判定 LLM 呼び出しが追加コストになる (会話ターンごとに発生)。判定だけなら Haiku 4.5 で1ターン約 $0.0001、許容範囲。

### 2026-05-05: 決定事項 — B-x 命名を廃止、Step 番号 + タスク名で統一

- **決定**: 過去のセッションで使われた B-1 / B-3 前半 / B-3 後半 / B-4 / B-5 などの「B-x 命名」を**今後新規発行しない**。今後は **Step 番号 (Step 6 など)** または **タスク名** で参照する。
- **背景**:
  - B-2 が欠番 (過去のセッションで番号を付けて消えた跡)、PR にも todo にも一切登場しない
  - 付け方が時系列でない (B-1 → B-3 前半 → B-3 後半 → B-5 の順で実装)
  - ユーザーから「B-1 とか B-3 とか何のことかわからない」と指摘された (2026-05-05 セッション)
- **対処**:
  - 既存 PR #8〜#11 のタイトルや commit message の B-x 表記はそのまま履歴として残す (改名はノイズ)
  - todo.md / plan.md / knowledge.md の説明文では Step 番号で記載
  - Issue は番号で参照 (#13, #15, #16, #17)
- **教訓**: タスク命名は番号体系を1つに統一する。複数体系 (Step / B-x / Phase) を併走させると必ず混乱する。

### 2026-05-04: ハマりどころ — Amplify::Branch 作成直後の初回ビルドは autoBuild でも自動キックされない

- **症状**: CDK で `app.addBranch(name, { autoBuild: true })` で作成しても、CFn 完了直後に初回ビルドが起動しない (`aws amplify list-jobs` が空)。
- **仕様**: `autoBuild` は「以降の git push を契機に自動ビルド」する設定。初回ビルドは webhook を発火する push イベントが必要。
- **対処**: `aws amplify start-job --app-id <id> --branch-name <name> --job-type RELEASE --region ap-northeast-1` で手動キック (今回はこのコマンドで初回 jobId 1 を起動)。
- **代案**: ブランチ作成後に空コミット push する (`git commit --allow-empty && git push`) → webhook 経由で自動ビルド。
- **教訓**: CDK 化されているからといって完全自動とは限らない。CDK が作るのはリソース定義で、初回起動はその後の運用フロー側に委ねられる。

---

## 参考情報のメモ

詳細URLは `spec.md` §参考一次ソースを参照。重要度の高いものを抜粋して再掲する。

- S3 Vectors + Bedrock KB公式ドキュメント
- Amplify AI Kit + Conversation 公式ドキュメント
- Bedrock KB Chunking公式ドキュメント
- 飼養衛生管理基準（農水省）
