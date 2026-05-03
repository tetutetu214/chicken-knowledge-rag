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
