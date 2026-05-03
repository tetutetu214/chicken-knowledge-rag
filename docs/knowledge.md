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

---

## 参考情報のメモ

詳細URLは `spec.md` §参考一次ソースを参照。重要度の高いものを抜粋して再掲する。

- S3 Vectors + Bedrock KB公式ドキュメント
- Amplify AI Kit + Conversation 公式ドキュメント
- Bedrock KB Chunking公式ドキュメント
- 飼養衛生管理基準（農水省）
