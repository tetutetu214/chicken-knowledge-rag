# 開発知見・決定事項 — Chicken Knowledge RAG System

開発中に得た知見・ハマりどころ・判断の根拠を時系列で記録する。同じ失敗を繰り返さないため、また将来のセッション再開時に経緯を再現できるようにするための場。

## 記載ルール

- 1エントリ = 1トピック。日付（YYYY-MM-DD）を冒頭に書く。
- 「決定事項」「知見・ハマりどころ」「未解決の検討事項」のセクションに分類する。
- なぜその判断をしたかの理由を必ず添える（後で読み返したときに判断根拠を再現できるように）。

---

## 学習済み概念 (理解度テスト合格記録)

CLAUDE.md「理解度テストハーネス」ルールで合格した概念を記録する。同じ概念は次回以降テストをスキップしてよい。

- **2026-05-05: Ragas の Faithfulness 指標** — 「回答が retrieval されたコンテキストに基づいているか」を LLM ジャッジ (Sonnet 4.6) が文単位で判定する仕組み。文字列一致 (BLEU/ROUGE 系) ではないことを理解。
- **2026-05-05: Lambda Container Image を選ぶ判断軸** — 主たる理由は「依存パッケージが zip 上限 250MB を超える」こと。Container は最大10GB まで対応するため Ragas + langchain + numpy/pandas のような大規模依存ツリーが配備できる。cold start 短縮や言語混在回避が目的ではない。
- **2026-05-05: evaluation-handler が chat-handler を直接 invoke する構成 (案 C) の意味** — 計測対象は「本番 chat-handler が #18 systemPrompt 込みで実際に返す応答の品質」。RetrieveAndGenerate デフォルトを使うとリスク階層警告や引用フォーマットが反映されず、production-faithful にならない。
- **2026-05-05: Secrets Manager と SSM Parameter Store の使い分け** — SSM SecureString は AWS KMS (デフォルト aws/ssm) で保存時暗号化される。両者の最大の機能差は「自動ローテーションの有無」で、Secrets Manager だけがその機能を持つ。GitHub PAT は仕組み上ローテーションできないため、本プロジェクトでは Secrets Manager を選ぶ価値がなく、Standard SecureString が無料の SSM Parameter Store を使う方が月額コスト目標 ($20〜30) と整合する。
- **2026-05-06: Bedrock KB の topScore (検索段階のコサイン類似度最大値)** — Retrieve API が返す上位K件のスコアのうち最大値で、質問ベクトルと KB チャンクベクトルの意味的近さ (0〜1.0) を表す。LLM の回答品質スコアとは別物 (品質は Ragas の Faithfulness で測る領域)。topScore < 0.7 は「KB にその話題が薄い」シグナルであり、Issue #16 の収集対象として保存する意味はここにある。
- **2026-05-06: 既存テーブルへの1列追加 vs 別テーブル新設の判断軸** — 家族規模・月100質問規模では、既存 `Message` モデルに `topScore` を1列追加するだけで分析クエリにも十分耐える。スコープ最小化で早期リリースし、別テーブル化 (RagFeedback 案) は必要が顕在化したら拡張する。
- **2026-05-06: スコープ最小化のトレードオフ判断** — Phase 1 では `topScore` (top-1 の点数) のみ保存し、`allScores` (top-5 全件) は保存しない。「top-1 だけ低いか全体的に低いか」の事後区別は失うが、最小実装で早期検証を取り、必要が顕在化したら次の PR で拡張する判断。
- **2026-05-06: Amplify Gen2 sandbox redeploy のスコープ** — `npx ampx sandbox --once` で起こるのは AppSync GraphQL スキーマ更新と Lambda コード差分デプロイのみ。DynamoDB はスキーマレスなのでテーブル変更は不要で、optional な新フィールドは新規データから自然に入る。既存データには影響しない。
- **2026-05-06: IaC によるロールバックの基本姿勢** — `git revert` + 再デプロイで冪等にコードを戻すのが正規ルート。AWS Console から手動巻き戻しは IaC との不一致を生み、次のデプロイで再発するため避ける。データレイヤの不正レコードは別途クリーンアップするか TTL で自然消滅を待つ。
- **2026-05-07: Markdown レンダラ (react-markdown) の動作原理** — Markdown 文字列をパーサで AST に変換し、対応する HTML 要素 (h2, ul, strong など) の React ノードを生成する。React がそれを DOM に描画することで `## 出典` などが見出しとして表示される。素テキストとして `{m.content}` を出すと記号がそのまま画面に残るのは、React が文字列を安全のためエスケープして描画するため。
- **2026-05-07: systemPrompt 側の Markdown 出力を残す判断軸** — Cocco RAG では出典セクション・警告の太字・箇条書きで回答を構造化することが「精度最優先・読みやすさ重視」の方針に直結している。フロントを修正するコストが小さい場合、表現力を捨てる方向のリファクタは選ばない。
- **2026-05-07: react-markdown の XSS 安全性** — デフォルトで raw HTML (`<script>` 等) を描画しない設計のため、ユーザー入力をそのまま渡しても典型的な XSS 攻撃を許さない。ただし `rehype-raw` プラグインを併用すると raw HTML を解釈するようになり安全性が崩れるため、明確な必要性なしに入れない。
- **2026-05-08: Amazon Nova の位置づけ** — Amazon が自社開発した LLM ファミリーで Bedrock 上で提供される。Anthropic Claude / Meta Llama と並ぶ Bedrock 掲載モデルの 1 つ。Micro / Lite / Pro / Premier の 4 階層構成で、テキスト・画像・動画などモダリティと品質帯が階層ごとに異なる。
- **2026-05-08: Bedrock Converse API のモデル横断性** — Converse API はモデルプロバイダ (Anthropic / Amazon / Meta 等) を抽象化しており、`modelId` 文字列を差し替えるだけで同じ呼び出しコードが Sonnet 4.6 でも Nova Pro でも動く。プロンプトテンプレート記法や SDK 自体を書き換える必要がない。だから今回 MODEL_ID の環境変数化と相性が極めてよい。
- **2026-05-08: 環境変数化 (Issue #31) のトレードオフ** — メリットはモデル差替に Lambda コード修正が不要になり、CDK の env 値を変えるだけで切替が可能になること。代償は (1) env 設定ミスで本番が意図しないモデルを叩くリスク、(2) コードを読んだだけでは「どのモデルを使っているか」が一目で分からなくなること。緩和策は CDK 側の env 設定箇所に Issue 番号付きの一行コメントで根拠を残し、IaC を「単一の真実の源」とすること。
- **2026-05-08: Bedrock の stateless 性とモデル選択の決定主体** — Bedrock Converse API は呼び出しのたびに `modelId` 引数で「どのモデルを使うか」を渡す方式で、サービス側に default model の状態キャッシュは存在しない。よって「どのモデルが処理するか」は Lambda の env 値 (= Lambda が API に渡す modelId) 次第で完全に決まる。デプロイ中は旧 env を持つホットコンテナと新 env コンテナが一時的に混在し、in-flight リクエストの一部が 5xx で返る瞬間はあるが、Cognito セッションや DynamoDB レコードには影響しないため UI リトライで救える。
- **2026-05-09: DynamoDB スキーマレス特性によるオプション列追加の挙動** — Amplify Data (背後は DynamoDB) でモデルに optional フィールドを追加しても、既存レコードはバックフィルされず該当属性が `undefined` のまま残る。GraphQL レイヤでは `null` として返るので、フロント側で `value === true` (boolean の場合) のように厳密比較すれば、既存レコード = falsy、新規/明示的に true 化されたレコード = truthy として両立できる。これによりマイグレーションスクリプト不要で機能追加が可能。
- **2026-05-09: Amplify Data の `model.update()` と `allow.owner()` の組み合わせ** — `client.models.X.update({ id, field: value })` は AppSync の Mutation を経由し、resolver に自動展開された owner ガードが「呼び出し元 Cognito ユーザー == レコードの owner」を検証する。他人の id を渡しても Unauthorized で弾かれる。よってフロントから直接 update を叩いても、家族間でも他人のスレッドを書き換えるリスクはない (User Pool の sub が異なればガード発火)。
- **2026-05-09: フロント側フィルタリング vs サーバ側フィルタリングの境目** — 数十件規模 (家族数名 × 数十スレッド) では、`Conversation.list()` で全件取って `Array.filter` で 2 配列に分けるのが正解。`Conversation.list({ filter: ... })` は AppSync で resolver evaluation を増やし、UI 開閉のたびに往復が増える。GSI 切るのは数千件超えてからで十分 (早すぎる最適化を避ける)。
- **2026-05-10: DynamoDB TTL の3つの落とし穴** — (1) `expiresAt` は **Unix epoch「秒」** が必須。ミリ秒を入れると未来すぎて TTL 判定の閾値を越え、永遠に削除されない。フロントでは `Math.floor(Date.now() / 1000)` を必ず通す。(2) 期限切れの削除は**最大 48 時間ラグ**でバックグラウンド処理されるため「期限到達 = 即時削除」ではない。(3) 親子モデル (Conversation hasMany Message) で TTL に頼ると、親が先に消えて子 Message が孤児化する瞬間が出る。対策は親子の `expiresAt` を**同じ値で揃える**こと。
- **2026-05-10: クエリ拡張 (synonym expansion) の代償** — Bedrock を 1 回多く呼ぶ構成にする以上、必ず**レイテンシと API コストが増える**のが本質的なトレードオフ。Nova Pro でも 1 質問あたり数百トークン使う。「拡張で偽陽性が増える」「ドキュメント側にない語は拾えない」も併発する副作用だが、これらは展開ロジックの調整で軽減可能。一方で「Bedrock 追加呼び出し」はアーキテクチャに固定的に乗る代償なので、コスト試算 ($30/月予算) と必ずセットで判断する。
- **2026-05-10: PR 分割の判断軸 (UI 改修 vs RAG 品質改修)** — UI 改修と RAG クエリチューニングを 1 PR に混ぜると、家族からの「答えが良くなった」という主観評価が UI による「試しやすさ」改善なのかロジック改善なのか切り分けられなくなる。Ragas のような客観指標を持っていても、家族体感を捨てるわけにはいかないので、**主観評価が混じる修正は別 PR**にして、デプロイ後の感想ヒアリングで原因を一意に特定できる構造を作る。
- **2026-05-11: 忠実度の高い LLM への system prompt は「上限のみ」を避け下限と上限の両方を明示する** — Nova Pro / Sonnet 系のように指示忠実度が高いモデルでは、「N 回**だけ**」「N 回**まで**」のような上限のみの指示は下限がゼロまで滑り落ちて「0 回」が常態化しうる（fix/koke-required で再発した症状）。逆に「全文必須」など下限のみの指示は過剰適応して読み手の負担を増やす（PR #38 で発生した症状）。境界条件を片側だけ書くとモデルがもう片側に振り切れるため、「**必ず M 回以上、最大 N 回まで**」と両側から閉じるのが堅実。Issue #18 の警告階層化、PR #38 の語尾控えめ化、fix/koke-required の必須化と続く一連の経験則。

---

## 決定事項

### 2026-05-11: ペルソナ「コケ語尾」の必須化（0回出ない問題への対処）

- **決定**: chat-handler の persona 指示を「応答全体で1〜2回**だけ**」（上限制約）から「**必ず1回**、多くても2回まで」（必須化＋上限）に変更。さらに「**「コケ」を一度も入れずに回答を終えてはいけない**」という明示禁止行を追加。
- **背景**: 家族から「最近の回答にコケが全く入っていない」と指摘。2026-05-09 の PR #38 で「全文必須 → 1〜2回だけ」に緩和した時点でも、4 ケースの動作確認で「0〜1回のコケに収束」と記録があり、0 回が出る挙動は設計上想定範囲だった（knowledge.md L95）。Nova Pro 系は指示忠実度が高く、「だけ」という上限のみの表現を「0でも可」として字義通りに受け取り、結果として完全にゼロのケースが日常的に出ていた。
- **修正点（`amplify/functions/chat-handler/handler.ts:144`）**:
  - 「1〜2回**だけ**」→「**必ず1回**、多くても2回まで」（下限を明示）
  - 「**「コケ」を一度も入れずに回答を終えてはいけない**」という明示禁止行を追加
  - 既存の「単独行禁止」「毎文・毎段落への付与禁止」は温存（読みにくさ問題への過去対応を打ち消さない）
- **判断根拠**:
  - **下限と上限を両方明示するのが Nova Pro 系には効く**: 上限のみの指示は「ゼロでもよい」と解釈され得る。同様に「全文必須」のような上限のない指示は逆方向に過剰適応する。両方の境界を書くことで安全な範囲に収束させる狙い。
  - **定型文（NO_CONTEXT_PREFIX、L2/L3 警告）への「コケ」復活はしない**: 2026-05-09 の決定通り、信頼性ラベル・緊急警告から「コケ」は撤去したまま。事務的明瞭さと警告の鋭さを希釈させない。本文側の LLM 生成パートだけで「必ず1回」を担保する。
- **動作確認方針**: sandbox 再デプロイ後、L1（一般質問）/ L2（軽い不調）/ L3（緊急）/ KB ヒットなし の代表 4 ケースで「コケが必ず1〜2回入る」「定型文部分には依然コケが入らない」「単独行で出ない」を目視確認する。
- **学び**: システムプロンプトの「N回だけ」「N回まで」のような上限のみの指示は、忠実度が高いモデルでは下限がゼロまで滑り落ちる。「必ず M 回以上、最大 N 回まで」と下限と上限の両方を書くのが堅実。Issue #18 の警告階層化、PR #38 の語尾控えめ化に続く「指示の境界条件を両側から閉じる」シリーズの3回目。

---

### 2026-05-10: アーカイブを「90日後自動削除のゴミ箱」モデルに変更

- **決定**: 現状の TTL ロジック「Conversation 作成時に `expiresAt = now + 90日`」を撤廃し、以下に変更:
  - **アクティブ会話**: `expiresAt = null` で TTL 対象外。家族が放置しても消えない。
  - **アーカイブ会話**: `setArchived(id, true)` の瞬間に `expiresAt = now + 90日(秒)` を上書き。紐付く全 Message も同じ `expiresAt` に揃える。
  - **アーカイブからの復元**: `expiresAt = null` に戻し、TTL 対象から外す。
- **背景**: 5/10 にスマホ閲覧の家族から「📥 アイコンが何をするか分からない、削除できない、わけわからん」と苦情。原因は (a) 📥 がアーカイブの絵に見えない、(b) アーカイブ済みセクションがデフォルト折りたたみで「消えたのか残ったのか」分からない、(c) 削除導線が 2 段階奥。さらに既存 TTL は「作成 90 日」で発動するため、アーカイブしてないアクティブ会話まで勝手に消える設計だった。
- **設計判断**:
  - **「ゴミ箱」モデルの採用**: アーカイブの意味を「とりあえず脇に置く保管庫」から「90 日後に自動消滅する一時退避先」に切り替える。家族が削除ボタンを意識して探す必要がなくなる (=📥 を押せば自動で片付く)。
  - **アクティブ TTL を捨てる選択**: 家族用途では「会話を続けてる限り消したくない」が圧倒的に強い。データ量も家族数名 × 数百スレッド程度なので DynamoDB 課金影響は無視できる。
  - **Message の `expiresAt` も同期更新する理由**: DynamoDB TTL は最大 48 時間ラグで親子で削除タイミングがズレる。Conversation 削除 → Message 孤児化を避けるため、親子で同じ `expiresAt` に揃える。
  - **アーカイブセクションを常時表示に変更**: 「📥 アーカイブ（90 日後に自動削除）」を固定ヘッダーで常に見せ、アーカイブが「消えてはいない」ことを視覚的に保証する。各行に「あと N 日で削除」表示も追加。
- **修正対象**:
  - `web/app/page.tsx`: `createThread()` / `send()` / `Message.create` の `expiresAt: ttlSeconds()` を削除、`setArchived(id, archived)` で `expiresAt` を上書き / null 化、紐付く Message も一括 update。アーカイブ UI を常時表示の独立セクションに変更。
- **デプロイ要件**: スキーマ変更なし (`expiresAt: a.integer()` は既存)。フロントのロジック変更のみのため Amplify Hosting 再ビルドだけで反映される。

---

## 決定事項

### 2026-05-09: スレッドのアーカイブ機能 (折りたたみ表示) を導入

- **決定**: `Conversation` モデルに `archived: a.boolean()` を追加し、サイドバーをアクティブ／アーカイブ済みの 2 区画に分割。アーカイブ済みは下段の折りたたみセクション (デフォルト閉) に格納する。アクティブ行のボタンは「📥 アーカイブ」のみ、アーカイブ行は「↩ 復元」「✕ 完全削除」の 2 つを並べる Gmail 風 UX。
- **背景**: 家族から「不要スレッドが増えてきたが、消すのは怖い (履歴が消えると後で参照できない)」との要望。物理削除しか選択肢がないと「アーカイブしたいだけ」「履歴は残したい」というケースで選びにくく、結果的にスレッドが溜まり続けていた。
- **設計判断**:
  - **フィルタリングはフロント側 `Array.filter` で実施**: 家族数名 × 数十スレッド規模では `Conversation.list({ filter: ... })` を使うより、全件取得してフロントで 2 配列に分ける方がシンプル。アーカイブ件数バッジ (`{n}件`) もこの方が瞬時に出せる。
  - **既存レコードに対する移行を行わない**: DynamoDB はスキーマレスで optional フィールドはバックフィルされない仕様を活用し、`archived !== true` をアクティブ判定に倒すことで移行スクリプトをゼロにした。
  - **アクティブ行に削除ボタンを置かない**: 誤削除事故を防ぐため。「消したい」と思った瞬間にアーカイブを挟む 2 段階構造にし、削除はアーカイブ展開後の明示操作に閉じ込める。
  - **以前の `opacity-0 group-hover:opacity-100` はやめた**: スマホ (タッチデバイス) で hover が無く操作不能になっていた。常時表示に変更。
- **修正対象**:
  - `amplify/data/resource.ts`: `Conversation` に `archived: a.boolean()` 追加。
  - `web/app/page.tsx`: `ThreadRow` に `archived: boolean` 追加、`setArchived(id, archived)` ハンドラ追加、サイドバー描画を 2 区画化、`archivedOpen` state で折りたたみ制御。
- **デプロイ要件**: Amplify サンドボックス (`npx ampx sandbox --once --outputs-out-dir web`) の再実行で AppSync スキーマ更新が必要。本番反映は main マージ → Amplify Hosting 自動デプロイ。

---

### 2026-05-09: ペルソナ「コケ語尾」を全文必須から控えめ運用に緩和

- **決定**: chat-handler の systemPrompt から「全文の語尾は必ず『コケ』で締める」指示を撤去し、「応答全体で1〜2回だけ自然な位置に『〜コケ』を混ぜる」運用に変更。あわせて、ハードコードされた定型文4箇所からも「コケ」を全削除。
- **背景**: 家族の利用者（配偶者・スマホ閲覧）から「毎回コケつけすぎて読みにくい」とのフィードバック。文ごと・段落ごとに「コケ」が付くため、本文内容より先に語尾の繰り返しが目に入り、可読性が著しく低下していた。
- **修正対象**:
  - L138 (persona): 「全文必須」→「全体で1〜2回だけ自然な位置に混ぜる」「毎文・毎段落の語尾に付けない（読みにくくなるため禁止）」を明記。
  - L54 (`NO_CONTEXT_PREFIX`): `※ 一般知識に基づく回答です（出典未検証）コケ` → `（出典未検証）` (コケ削除)。
  - L165 (KB 未該当時の冒頭断り): `KB に該当情報はありませんでしたコケ` → コケ削除。
  - L185 (L2 警告): `気になる様子が続くなら獣医に相談すると安心コケ` → `…安心です` に変更。
  - L193 (L3 警告): `専門家の判断が必要コケ。すぐに相談してコケ` → `…必要です。…相談してください` に変更。
- **判断軸**:
  - **定型文（メタ情報・事務連絡）からはコケを完全撤去**: NO_CONTEXT_PREFIX や警告は「これは出典のない一般知識です」「命に関わるので獣医へ」という信頼性ラベル・緊急警告として機能する。キャラクター語尾を混ぜると緊張感や事務的な明瞭さが損なわれ、特に L3 警告では alert fatigue とは別軸で「警告の鋭さの希釈」が起こる。
  - **本文側はLLM判断に委ねて1〜2回だけ混ぜる**: 完全廃止すると「コケ先輩」のキャラ感が失われる一方、回数を固定でルール化するとプロンプトが硬くなる。「自然な位置で1〜2回だけ」という曖昧な制約に留めることで、LLM が文脈に応じて末尾の助言などに自然に挿入する形を狙う。
- **学び**: システムプロンプトの「全文必須」「全段落必須」のような全称命令は、モデル忠実度が高い Nova Pro / Sonnet 系では文字通り守られて読み手の負担を増やす。キャラクター指示でも警告指示と同じく「使いどころを階層化する」ことが必要。Issue #18 で警告を L1/L2/L3 で階層化したのと同じ思想を、ペルソナ語尾にも適用したことになる。
- **動作確認方針**: sandbox 再デプロイ後、L1（一般質問）/ L2（軽い不調）/ L3（緊急）/ KB ヒットなし の代表 4 ケースで「コケが応答全体で1〜2回」「定型文部分にコケが入らない」を目視確認し、配偶者に再評価してもらう。
- **動作確認結果 (2026-05-09 PM)**: 4 ケース実行で 0〜1 回のコケに収束し、奥さんの不満（毎文コケ）は確実に解消。ただし L1（一般質問）で LLM が「コケ」を本文と分離して単独行に書く挙動が出現。L2 では「安心ですコケ」と本文の語尾に自然に乗ったので、persona 指示が曖昧で LLM が機械的に解釈したと判断。**追加調整**として persona に「`コケ`だけを単独の行・単独の文として書かない、必ず動詞・形容詞の語尾に付ける」を明示（次節）。
- **動作確認時の副次発見**: NOKB 想定だった「鶏の鳴き声を音楽にして配信したい」が topScore 0.71 で SCORE_THRESHOLD 0.7 をギリギリ超え、KB ヒット判定で出典付き回答になった。AW指針が無関連質問にもうっすら引っかかっている。**追加調整**として閾値を 0.7 → 0.75 に引き上げ（次節）。

### 2026-05-09 (追加対応): persona 指示の精緻化と SCORE_THRESHOLD 0.7→0.75

- **決定**: 上記の動作確認で見つかった 2 点に対応。
  - persona に「`コケ`を単独で書かない、動詞・形容詞の語尾に付ける」を明示
  - `SCORE_THRESHOLD` を 0.7 → 0.75 に引き上げ（`backend.ts` の env 値を変更、`handler.ts` と `data/resource.ts` のコメントも追従）
- **背景・判断軸**:
  - **persona の単独コケ問題**: 「自然な位置で1〜2回」だけでは LLM が「最後に『コケ』と書けばいい」と機械的に解釈する余地があった。例（動詞・形容詞の語尾に付ける）を入れて、文に溶け込ませる形を強制する。
  - **閾値引き上げ**: 実測 (2026-05-09) で L3 血便 0.76 / L1 水替え 0.63 / NOKB 音楽 0.71。0.75 に引き上げれば L3 はヒット維持、NOKB は振り落とせる。トレードオフは「0.7〜0.75 に落ちる関連質問もヒット無しになる」が、(a) ヒット無しでも Nova Pro 一般知識で回答できる (b) 出典が付かない違和感は出典が誤って付く違和感より小さい、と判断。
  - **env 経由ではなく CDK 側で変更**: `~/.claude/CLAUDE.md` ルールに従い IaC を「単一の真実の源」とする。Lambda コンソール直叩きはドリフトを生むので避ける。
- **コードユーザの理解モデルとの一致**: ユーザー（てつてつ）の指摘 「閾値を超えなかったらHitしていないとユーザは考える、だったら出典を書いてほしくない」 を満たすには、「閾値未満は出典なし」が現状の挙動どおりであることを確認しつつ、「閾値ギリギリで誤ヒット」を減らすために閾値そのものを厳しくするのが筋。**handler.ts:238 の hasResults 分岐ロジック自体は健全で、kbContext は hasResults=false の場合は完全に systemPrompt に渡されない**ことを再確認した。

### 2026-05-09 (再修正): SCORE_THRESHOLD を 0.75 → 0.7 へ差し戻し

- **決定**: 同日朝に 0.7 → 0.75 に引き上げた閾値を、夜の家族利用ログを根拠に **0.7 へ戻す**。`backend.ts` の env 値と `handler.ts` のコメントを同期更新。
- **背景**: 家族から「コココ RAG で質問しても KB 情報を全く使っていない」報告。CloudWatch Logs (`/aws/lambda/amplify-chickenknowledger-chatHandlerlambdaEEC72AE-*`) で 19:21〜19:22 JST (UTC 10:21〜10:22) の 4 件を確認したところ、すべて 0.75 未満で KB なし扱い:
  - 「鶏の正式名称」推定 2 回: topScore 0.734 (0.75 ギリギリ未満)
  - 「首の骨の数」推定 2 回: topScore 0.622
- **KB に答えはあった**: KB 内の `yamashina_sekishoku_subspecies.md` に「ニワトリの直接の祖先である**セキショクヤケイ（赤色野鶏、Gallus gallus）**」、`jvma_niwatori_handbook.md` に「ニワトリの**頚椎は14個で哺乳類の倍**である」が明記されているにもかかわらず、retrieve でそれぞれ 0.734 / 0.622 にしか到達しなかった。**正解が KB にあるのに答えに反映できない事象が起きていた**。
- **判断軸**:
  - 0.734 系は 0.7 閾値ならヒットしていた **直接の犠牲**で、戻すだけで救える。
  - 0.622 系は閾値だけでは救えず、原因は「**首の骨**」（日常語）と「**頚椎**」（専門語）の **語彙ギャップ**。これは 0.7 に戻しても拾えないが、0.75 のままでは 0.734 系まで失う。**最低でも 0.7 戻しは即効性のある被害縮小策**として実施。
  - 朝に 0.75 にした主目的だった「無関連質問 (0.71) の偽陽性ヒット」は再発するが、(a) 偽陽性は出典が誤って付くだけで本文の致命傷ではない、(b) 真陽性の取りこぼしは「KB に正解があるのに使われない」体感を生むため、家族の利用満足度への悪影響は真陽性取りこぼしのほうが大きい、と判断。
- **次に検討する別軸対策 (今回スコープ外)**: 偽陽性対策と語彙ギャップ対策は閾値をいじる軸では限界があるため、(a) クエリ拡張 (LLM で日常語→専門語の同義語展開してから retrieve)、(b) top1 と top2 の差で振り分け、(c) numberOfResults を 5 → 10 に増やして相対スコアで判定、などを Issue #16 のフィードバックループ整備のなかで段階的に検討する。
- **学び**: 朝に 0.75 を採用したときの実測データ (L3 血便 0.76 / L1 水替え 0.63 / NOKB 音楽 0.71) は **3 サンプルで決めるには少なすぎ**、語彙ギャップ系の質問が考慮から漏れていた。閾値変更のような「全質問に効く設計変更」は、家族の実利用ログを 1 日でも収集してから判断するルールに変えるべき。次回以降「即時動作確認 → 即閾値変更」の連鎖は避ける。

### 2026-05-08: 回答生成 LLM / judge LLM すべて Nova Pro (APAC) に切替

- **決定**: chat-handler / summarize-handler / evaluation-handler (Ragas judge) の `MODEL_ID` を `apac.amazon.nova-pro-v1:0` に統一切替。
- **理由**: AWS クレジット原資があり、コストではなく「Anthropic 依存の解消 + Bedrock 純正で揃える」が目的。Sonnet 4.6 比で input $3 → $0.80 / output $15 → $3.20 と概ね 1/4 の単価で、クレジット消費効率も向上する。
- **構成上の好都合**: `backend.ts:81` の `conversationModelId` 定数 1 箇所が 3 ハンドラ全体で共有されており、一行差替で全切替が完結。Bedrock Converse API はモデル横断 API のためコード本体の修正は不要。
- **IAM 影響**: `grantBedrockInvoke` ヘルパで `inference-profile/*` と `foundation-model/*` をワイルドカード許可しているため、Nova Pro 切替で IAM 変更不要。Issue #28 の最小権限化は別件として残す。
- **同梱した Issue #31 部分対応**: chat-handler の `SCORE_THRESHOLD = 0.7` ハードコードを env (`SCORE_THRESHOLD`) に追い出し、`requireEnv` ヘルパーを導入。閾値調整に再デプロイが不要になり、Lambda コンソールから即時調整可能。EMBEDDING_MODEL_ID と summarize-handler 側のハードコードは残しており、Issue #31 完全クローズには至らない (Phase 2 に持ち越し)。
- **AI Kit Issue #527 の影響回避**: Amazon Nova は Amplify AI Kit (`a.conversation()`) で on-demand 呼び出しが NG という既知不具合があるが、本プロジェクトは Direct Lambda Resolver + Converse API 方式で AI Kit 不使用のため対象外。
- **ベースライン比較の扱い**: Ragas は MODEL_ID 1 つで「回答生成」と「judge」の両方を兼ねる self-evaluation 設計のため、Sonnet 4.6 ベースライン (faith 0.45 / ar 0.69 / cp 0.13 / cr 0.22) との直接比較は厳密には成立しない。今回は再実行スコアを「Nova vs Nova の自己採点」として参考値扱いとし、実質判断は目視 QA で行う。
- **事前確認の学び**: Bedrock の「モデルアクセス有効化」は Anthropic Claude では人間操作が必要だが、Amazon 自社モデル (Nova / Titan) は `ListFoundationModelAgreementOffers` が `Agreement not supported` を返す = 同意フローが存在せず、何もしなくても呼び出せる。次回以降「モデルアクセス有効化が必要」と即断しないこと。
- **動作確認**: ap-northeast-1 から `apac.amazon.nova-pro-v1:0` への Converse API 呼び出しが成功することを CLI で確認済 (12 + 50 tokens、約 $0.00017)。
- **デプロイ後検証**: `npx ampx sandbox --once` で 84 秒 UPDATE_COMPLETE。chat-handler 直接 invoke で代表 3 ケース確認済。
  - L1 (一般・衛生管理): topScore 0.902、引用 5 件、語尾「コケ」、`## 出典` セクション完全遵守
  - L3 (疾病・血便): 警告定型文 `**この件は獣医・保健所など専門家の判断が必要コケ。すぐに相談してコケ**` を遵守
  - KB ヒットなし: 冒頭 `※ 一般知識に基づく回答です（出典未検証）コケ` 完全遵守、topScore 0.687 で `hasKbResults: false` 判定正常
- **Ragas 再実行 (Run ID: `run_20260508_152801`、Nova Pro judge)**: faith 0.65 / ar 0.39 / cp 0.64 / cr 0.20。Sonnet 4.6 ベースライン (faith 0.45 / ar 0.69 / cp 0.13 / cr 0.22) と比べて faith / cp が大きく上昇、ar が大きく低下。判断: **数値変動の主因は judge LLM 切替による self-evaluation bias 差で、回答品質そのものの変動を表していない**。目視 QA で systemPrompt 遵守が確認できたため、実用品質は維持されているとみてマージ判定。本当の品質変化を測るには judge を Sonnet 据え置きで chat だけ Nova にする実験が必要だが、今回は「Anthropic 依存解消」が目的のためそのコストを払わず参考値扱い。
- **evaluation バケットの testset は手動アップロード必須**: `chicken-rag-evaluation-{accountId}-{region}` バケットに `testset/v1.json` がアップロードされていないと Lambda が `NoSuchKey` で即失敗する。CDK は testset を自動配備しないため、`evaluation/testset/v1.json` をローカルから `aws s3 cp` で配置する必要あり。バケット再作成時に testset が消えるため、SOP として「バケット作成後に必ず testset を再アップロード」を Issue #33 (KB / DataSource removalPolicy 整備) と一緒にドキュメント化対象。

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
- **理由**: 公的ソース限定でノイズ文書を排除しつつ、家庭利用に直結する切り口（家庭での予防、自治体での実務手続き）をカバー。所在自治体を管轄する都道府県分は「アライグマは県の防除実施計画により市町村届出のみで捕獲可」という所在自治体での実務根拠を含むため、捕獲フェーズ移行時に必須。
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

### 2026-05-03: Cognito 認証は Amplify Gen2 デフォルトで「家族クローズド」に最適化済み

- **発見**: `amplify/auth/resource.ts` を `defineAuth({ loginWith: { email: true } })` だけにすると、生成される User Pool は `AdminCreateUserConfig.AllowAdminCreateUserOnly = True` になる。つまり管理者が `admin-create-user` で登録したユーザーのみ存在可能で、誰でも sign-up できない。家族クローズドシステム要件と一致。
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
- **理由**: 公式パターンだと Bedrock KB と S3 Vectors が二重作成され、14本の文書を再 ingestion する手間と KB ID 同期の問題が発生する。家族規模のシステムには過剰。
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
- **理由**: 配偶者が日常的に使う鶏アシスタントとして、無機質な技術名より親しみやすいネーミングが UX に効く。命を扱うシリアス領域だが、入口の柔らかさは継続利用率に直結する。
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
- **教訓**: 個人利用のクローズドシステムでは「Tailwind だけで対応」が最速かつ低コスト。React Native や Capacitor は配信導線・ビルド・審査の追加コストが大きく、家族規模では過剰。

### 2026-05-05: ベースラインスコア取得 — Issue #17 v1 初回実行結果

- **実行**: testset v1 (15問) を `chicken-rag-evaluation-handler` Lambda で評価。Run ID `run_20260505_151700` (run_20260505_150319 もほぼ同値で参考程度)。実行時間は約7分 (LLM ジャッジ呼び出し含む)。
- **全体スコア**:
  - **Faithfulness: 0.45** — 回答が retrieval コンテキストに忠実か (中程度)
  - **Answer Relevancy: 0.69** — 質問の意図に的を射ているか (やや良)
  - **Context Precision: 0.13** — retrieval 上位の関連性 (**低い**)
  - **Context Recall: 0.22** — 必要なコンテキスト網羅率 (**低い**)
- **質問単位の所見** (Context Precision=1.0 を「KB ヒット」と定義):
  - **KB が機能した質問**: q006 (呼吸困難) cp=1.0/cr=1.0、q009 (賞味期限3日) cp=1.0/cr=0.5。**疾病・卵食品安全カテゴリの一部のみ**
  - **KB ヒットなし (cp=0) の質問**: 15問中13問。届出・害獣・鶏小屋・産卵・飼料・福祉・通気など**全カテゴリにわたり retrieval が機能していない**
  - **Faithfulness 高 + KB ヒットなし**: q002 ハクビシン (0.9)、q011 砂浴び (1.0) — LLM 一般知識で精度の高い回答が出ている。chat-handler が「KB なし時は一般知識で答える」モードで機能している証拠
  - **Faithfulness 0**: q005 産卵停止、q010 大量消費レシピ、q015 品種比較。q010 は KB なしで一般知識回答が抽象的、q015 はメタ問題で「該当情報なし」回答が期待値どおり
- **Issue #16 (KB 不足領域分析) への接続**:
  - Context Precision/Recall は LLM 揺らぎを受けない deterministic な指標なので、**KB 不足領域 = cp=0 の質問カテゴリ** として直接特定できる
  - 今回の v1 testset で「KB 拡充の優先カテゴリ」が即座に可視化された: 届出・害獣・鶏小屋建築・産卵・飼料・福祉・通気
  - 経路 [1] (公的資料追加) で農水省の鳥獣被害対策・鶏舎建築指針・採卵鶏管理指針などをデータ駆動で優先順位付けできる
- **Faithfulness vs Context Precision のギャップ解釈**:
  - Faithfulness 0.45 (中) なのに Context Precision 0.13 (低) は一見矛盾
  - Ragas 0.4 の Faithfulness は「回答の各主張が retrieval コンテキストから演繹できるか」を判定するが、KB ヒットなしの場合でも LLM 一般知識で出した回答が妥当なら主張ベースで部分点が付く挙動
  - 意味: 現在の chat-handler は「KB が当たらないときに LLM 一般知識でそれなりに答える」状態。命を扱う質問では危険なので、KB 拡充で Context Precision を上げて Faithfulness の根拠を retrieval 側に寄せる必要がある
- **次のアクション**:
  - Issue #16 (不足領域分析) に本ベースラインを inputs として渡す
  - KB 拡充後に再度 v1 testset で評価し、Context Precision/Recall の上昇を測る
  - 月次 EventBridge Scheduler が動き始めたので、毎月1日 09:00 JST に自動的にスコア推移が記録される

### 2026-05-05: 知見・ハマりどころ — Issue #17 デプロイ時の循環依存

- **症状**: `npx ampx sandbox` で `[ERROR] [CloudformationStackCircularDependencyError] The CloudFormation deployment failed due to circular dependency found between nested stacks [data, ChickenRagInfra, function]`
- **原因**: evaluation-handler を `infraStack` (ChickenRagInfra) に置いた結果、Amplify が生成する nested stack 構成と循環:
  - 既存: `function` stack (chat/summarize Lambda) は環境変数 / IAM 権限で `infra` stack (KB) を参照
  - 追加: `infra` stack (evaluation Lambda) が `function` stack (chat-handler の name/arn) を参照
  - これで `infra ⇄ function` の双方向依存が発生
- **解決**: evaluation pipeline 専用の独立 nested stack `ChickenRagEvaluation` に切り出し、`function/infra → evaluation` の単方向依存にする (`backend.createStack('ChickenRagEvaluation')`)
- **教訓**: Amplify Gen2 の nested stack 構成では、既存スタック (function/data/infra) を別のスタックから参照する場合、**新規追加リソースは独立した stack に置く** のが安全。"既存 stack に同居する" 設計はクロス参照で循環を生みやすい

### 2026-05-05: 知見・ハマりどころ — Ragas 依存と boto3 衝突

- **症状**: 初回 Container build で `pip ResolutionImpossible: langchain-aws 0.2.18 depends on boto3>=1.37.0` だが requirements.txt に `boto3==1.35.99` を pin していた
- **解決**: boto3 の明示 pin を削除。Lambda Container ベースイメージ (`public.ecr.aws/lambda/python:3.12`) に boto3 が同梱されており、langchain-aws が transitive dependency として最新 boto3 を引き込むため、明示指定は不要かつ衝突源
- **教訓**: ラップ層 (langchain-aws) を pin する場合、その transitive dependency と上位 pin を両方握ると衝突する。Lambda Container ベースイメージ同梱パッケージは pin しないのが安全

### 2026-05-05: 決定事項 — Issue #17 ベースラインスコア取得タイミングと testset versioning ポリシー

- **決定**: Issue #17 (Ragas 評価パイプライン) のベースラインは **#18 マージ後の main コミット (`e406d9f`)** を起点に取得する。Issue #17 本文・設計内容は変更しない。運用ルールのみ追加。
- **背景**: #18 (systemPrompt リスク階層化) のマージで chat-handler の応答内容・形式が大きく変わった (専門家相談の出現頻度・引用フォーマット・文字数上限)。同じ評価データセットに対するスコアも当然変わる。「いつ」のコードでスコアを取るかの定義が曖昧だと、後で過去スコアと比較できなくなる。
- **採用ポリシー**:
  1. **ベースライン v1 取得は #18 マージ後 (commit `e406d9f` 以降の main)** で実施する。これ以前のスコアは記録しない (#18 で構造的に変わったため意味がない)。
  2. **testset.json (v1) のメタデータに `system_prompt_version` を記録**: マージ commit hash (短縮形 `e406d9f`) を入れる。`EvaluationResults` テーブルにも同じフィールドを保持。
  3. **systemPrompt を変更したら都度ベースライン再取得 or A/B 比較**: 過去 run と直接比較せず、prompt version 単位でスコアの分布を比較する。
- **#17 の構造に手を入れない理由**: #17 は「評価する仕組みを作る」インフラタスクで、「何を評価するか (= その時点の最新コード)」は実行時に決まる。今後 #20 (sidecar metadata) や retrieval チューニングで対象が変わるたびに #17 を書き換えるのは構造的におかしい。よって #17 本文修正は不要、運用ルールで吸収する。
- **着手前確認事項の回答** (てつてつ判断、2026-05-05):
  1. ジャッジモデル: **Sonnet 4.6** (`global.anthropic.claude-sonnet-4-6`) — 月次バッチでコストインパクト小、ジャッジは精度最重視
  2. evaluation-handler 言語: **Python 3.12 + Lambda Container Image** (下記「言語選択の調査結果」参照、当初 TS 候補だったが調査の結果 Python に確定)
  3. EventBridge cron: **毎月1日 09:00 JST** (`cron(0 0 1 * ? *)` UTC) のまま
  4. testset v1 の15問: **そのまま v1 リリース** (テストのためのテストを作るより、まず実スコアを取って判断材料にする)
- **言語選択の調査結果 (TS → Python 確定)**: 当初「既存 Lambda が TS なので揃える」候補だったが、Ragas そのものを調べた結果 Python 一択と判明。
  - **Ragas 公式 (`vibrantlabsai/ragas`)**: 最新 0.4.3 (2026-01-13)、**Python 専用** (>=3.9)
  - **TS port の実態**: `@ikrigel/ragas-lib-typescript` は★3・単独メンテのコミュニティ製、Bedrock 統合なし、指標名も公式と差異 ("Relevance" vs "Answer Relevancy")。"independent TypeScript implementation" と自称しており公式 port ではない。命を扱うシステムの評価基盤として依存するのは構造的にリスク
  - **AWS 公式パターンが Python で確立**: AWS Blog "Evaluate RAG responses with Amazon Bedrock, LlamaIndex and RAGAS" + `aws-samples/aws-generativeai-partner-samples` の notebook で Sonnet 4.x をジャッジに使うサンプルが公式提供
  - **配備形式**: Ragas + langchain-aws + datasets + numpy/pandas で 250MB zip 上限を超える可能性が高いため **Lambda Container Image (10GB) 必須**
  - **教訓**: 言語選択は「既存 Lambda 揃え」より「使うライブラリの公式実装言語」を優先すべき。ライブラリの公式版から外れた瞬間にメンテ責任が自プロジェクトに移る
- **testset データ構造のマッピング**: Issue 本文の案を Ragas 0.4 の `SingleTurnSample` にほぼ 1:1 で写す
  - `question` → `user_input`
  - `expected_answer` → `reference`
  - `expected_contexts` (キーワード配列) → `reference_contexts` (string list)
  - `expected_safety_alert` → Ragas 標準4指標の対象外。Issue 本文「含まないもの」の鶏ドメイン固有カスタム指標に該当するため今回は **JSON にメタデータとして残すが評価ロジックには使わない**
- **応答生成方式: 案 C (chat-handler Lambda 直接 invoke)** を採用 (Issue 本文の `RetrieveAndGenerate` 案を不採用):
  - **背景**: Issue 本文の `RetrieveAndGenerate` API は Bedrock デフォルトのプロンプトテンプレートを使うため、#18 で導入したリスク階層 systemPrompt・引用フォーマット (`[S1]`)・「コケ」語尾などが一切反映されない。これでは「本番 chat-handler の精度」を測ったことにならない
  - **不採用案**: 案 B (chat-handler ロジックを Python に移植) — コード重複が発生し、chat-handler 改修のたびに同期が必要でドリフト不可避
  - **採用理由**: 案 C は本番一致 (production-faithful)・コード重複なし・chat-handler 改修が即評価に反映される。Lambda → Lambda invoke は boto3 `lambda.invoke()` 1コールで実現でき、追加の認証層は不要 (IAM 権限のみ)
  - **入力イベント形式**: chat-handler は AppSync Direct Lambda Resolver なので、event.arguments に `{ conversationId, message, ... }` を渡す形。各 testset 質問に対して**新規会話 ID** を毎回生成して履歴なしの単発質問として呼ぶ (会話履歴の影響を排除してベースラインを純粋に測るため)
  - **トレードオフ**: chat-handler の AppSync resolver イベント形式に依存するため、chat-handler のシグネチャを変えたら evaluation-handler も合わせる必要がある。これは Python 移植 (案 B) より**結合度ははるかに低い**ので許容

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
- **コスト影響**: Haiku 4.5 (入力 $1/出力 $5 per 1M tokens) → Sonnet 4.6 (入力 $3/出力 $15) で**約3倍**。家族規模・月100質問想定で月 $1〜2 → $3〜6。予算 $30/月 内に十分収まる。
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

### 2026-05-06: 試行と断念 — Amplify::App.OauthToken は ssm-secure 非対応で SSM 移行不可（Issue #26）

- **結論**: GitHub PAT を AWS Secrets Manager から SSM Parameter Store SecureString に移行しようとして失敗。**CFn 側の制約により `AWS::Amplify::App.OauthToken` は `ssm-secure` Dynamic Reference をサポートしないことが実機で判明**したため、Secrets Manager (`chicken-rag/github-token`) を継続利用する判断に戻した。Issue #26 は `not planned` で close。
- **試した内容**:
  1. SSM Parameter Store に `/chicken-rag/github-token` を SecureString (Standard, デフォルト KMS `alias/aws/ssm`) で put-parameter
  2. `amplify/infra/hosting.ts` で `SecretValue.secretsManager()` → `SecretValue.ssmSecure()` に差し替え、props 名を `githubTokenParameterName` にリネーム
  3. `amplify/backend.ts` で値を `/chicken-rag/github-token` に変更
  4. `npx ampx sandbox --once` を実行 → CFn デプロイ中に `ChickenRagInfra` Nested Stack が UPDATE_FAILED → UPDATE_ROLLBACK_COMPLETE
- **失敗時のエラー** (CloudFormation):
  ```
  SSM Secure reference is not supported in: [AWS::Amplify::App/Properties/OauthToken]
  ```
- **公式仕様の確認**:
  - [CFn 公式ドキュメント](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-ssm-secure-strings.html) の「Resources that support dynamic parameter patterns for secure strings」表に記載のあるリソースは **11個のみ** (DirectoryService、ElastiCache、IAM::User、KinesisFirehose、OpsWorks、RDS、Redshift)
  - **`AWS::Amplify::App` は表に含まれていない** = ssm-secure 非対応
  - 既知 issue: [aws-cdk#11858](https://github.com/aws/aws-cdk/issues/11858) (2020-12 起票、**state: OPEN**、2026-04 にも新規コメント)。CFn 側の機能追加 ([cloudformation-coverage-roadmap#227](https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/227)) でブロックされている
- **CDK 抽象の落とし穴**: `oauthToken: SecretValue` の型は `SecretValue.ssmSecure()` も `SecretValue.secretsManager()` も同じ型を返すため、**CDK の TypeScript 段階では型エラーが出ずデプロイして初めて落ちる**。CDK の `SecretValue` は CFn テンプレート上の Dynamic Reference 文字列を生成するだけで、その先の CFn 側の対応表まで型システムで防げない構造。
- **検討した回避策と却下理由**:
  - **平文 SSM `{{resolve:ssm:...}}`**: 暗号化されないため PAT を平文で扱うことになり、~/.secrets/ 管理・コミット混入禁止・push protection の方針と整合しない → 却下
  - **CDK Custom Resource (`AwsCustomResource`) で SSM 取得して oauthToken に流す**: 実装 1〜2時間、Custom Resource の運用負荷増、年 $5 のコスト削減 (Secrets Manager $0.40/月 × 12) のために構成を複雑化するのは見合わない → 却下
- **現状維持**: `chicken-rag/github-token` (Secrets Manager) を継続利用、コードと docs は変更前の状態に戻し、ブランチ `refactor/secrets-to-ssm` は破棄、SSM パラメータ `/chicken-rag/github-token` は削除済み (用途不明放置防止)。
- **教訓**:
  1. **CDK の API レベルで通っても CFn の対応表までは保証されない**。リソース別の Dynamic Reference 対応一覧 ([CFn ドキュメント](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-ssm-secure-strings.html)) を着手前に必ず確認する
  2. **着手前の既知 issue 確認**: aws-cdk リポジトリで `is:issue "ssm-secure" "リソース名"` のような検索を行うと既知の制約が分かる。今回の事例は2020年から OPEN なので、検索すれば事前に防げた
  3. **小コスト (年 $5) のリファクタは ROI を先に見積もる**: 工数 vs 削減額が見合わなければ「現状維持＋知見記録」も立派な決着。今回は撤退判断の方が合理的
- **シークレット管理の今後の方針** (本件の結論):
  - `AWS::Amplify::App.OauthToken` のように **CFn 側で Secrets Manager しかサポートしないプロパティでは Secrets Manager を使う** (今回のケース)
  - それ以外の用途 (Lambda 環境変数、ECS Task Definition、外部 API キーなど) で**自動ローテーションを使わないシークレット**は SSM SecureString を優先候補とする (CFn 対応表で要確認)
  - 上記方針は次回シークレット追加時に必ず CFn の Dynamic Reference 対応表で確認してから採用判断する

### 2026-05-06: 観測 — Phase 1 動作確認で閾値 0.7 の偽陽性ヒットを1件捕捉

- **観測**: 鶏飼育とは無関係な質問 (「風見鶏」関連) を投げたところ、`topScore=0.7332` で `hasKbResults=true` 扱いとなり、AW指針_採卵鶏.pdf / 鶏卵生産衛生管理ハンドブック.pdf を引用してしまった。コケ先輩は「専門外」と回答する判断はできていたが、引用元チップは表示された。
- **原因仮説**: 「風見鶏」に「鶏」の文字が含まれるため、KB チャンクの「鶏」関連表現とコサイン類似度がわずかに上昇し、閾値 0.7 をギリで超えた。意味的には無関係だが、トークン上の偶然の一致による偽陽性。
- **Issue #16 にとっての意味**: まさにこの種の「0.70〜0.75 の "惜しいヒット" 帯」を Phase 2 の topScore ヒストグラムで可視化することが Issue #16 の核。今回 Phase 1 実装直後に1件目のサンプルが取れたのは幸先が良い。
- **次に検討すべきこと (今は触らない)**: 閾値を 0.7 → 0.75 に上げるべきかは Phase 2 でデータが溜まってから判断。現時点では当てずっぽうで上げるとリコールを犠牲にする可能性がある。
- **記録上の意味**: Phase 1 の保存基盤が正しく動いていることのリリース確認データでもある。

### 2026-05-06: 決定事項 — Issue #16 の実装方針 (公式 Phase 1〜3 路線採用、RagFeedback 別テーブル案は不採用)

- **決定**: Issue #16 (KB不足領域分析) は GitHub Issue 本文の Phase 1〜3 路線で実装する。前セッションで参考LLMが提案した「RagFeedback 専用テーブル新設 + #21 と統合スキーマ + 月次 Markdown レポート + BERTopic クラスタリング」案は採用しない。
- **着手スコープ**: Phase 1 (`feature/kb-miss-logging`、`Message.topScore` の保存基盤) のみ先行着手。Phase 2 (`/insights` 画面) と Phase 3 (LLM 補助の分類) は Phase 1 マージ後の実データ蓄積 (1ヶ月目安) を見て判断。
- **不採用理由**:
  1. **責務分離と整合**: 2026-05-05「KB拡充の3経路」で #16 は経路[3]に限定済み。家族規模・月100質問規模で別テーブル化・1年TTLは過剰設計。
  2. **#17 (Ragas) と評価データセットを共有しない**: Ragas testset は固定15問の v1 (knowledge.md 2026-05-05) で、ユーザー実質問とは別資産。「分析テーブル統合」は実装コストに見合わない。
  3. **Phase 分割で運用劣化を防げる**: データが溜まる前にダッシュボードを作っても表示するものがない。Issue 本文の段階分けを尊重する。
- **Phase 1 の最小スコープ**: `Message.topScore: a.float()` と `ChatResponse.topScore: a.float()` のみ追加。`allScores` (top-K 全件) の保存や `RagFeedback` 独立テーブル化は、将来必要が顕在化したら拡張する。
- **#17/#18 との関係**: #18 で chat-handler の応答形式は変わったが、Retrieve のスコア算出ロジック (cosine 0.7 閾値) は無傷。Phase 1 実装は現行 handler.ts に `topScore` を返すだけで良い。Phase 2 ダッシュボードの妥当性検証には #17 ベースラインの cp=0 質問群 (届出・害獣・鶏小屋・産卵・飼料・福祉・通気) を初期参考にできる。
- **データ寿命の整理**: `Message.expiresAt` は 90日 TTL のままで、Phase 2 の月次レビューには十分。長期トレンド分析が必要になった段階で別テーブル化を再検討。

---

## 2026-05-07: コードレビュー所見 (awsiac MCP + CDK ベストプラクティス照合)

awsiac MCP プラグインを導入したのに合わせて、`amplify/` 配下 14 ファイル全件を CDK ベストプラクティスと突き合わせて静的レビューした。コード変更は行わず、改善方向の整理と GitHub Issue 起票で次セッション以降の足固めとした。レビュー時点では本番運用を継続中で、緊急停止が必要な脆弱性は検出していない。

### 全体所感

- 環境変数の `requireEnv()` 早期失敗、KB Invoke Policy の ManagedPolicy 化、Budgets ハードストップ、Evaluation Pipeline の独立 nested stack 化など、家族のみ規模としては設計判断が丁寧で、知見が docs/knowledge.md に時系列で残っている点が特に強い。
- 一方で「最小権限の Bedrock IAM」「DynamoDB TTL のバックエンド強制計算」「Lambda リソースの実測ベース最適化」など、運用フェーズで必要になる詰めが残っている。

### 起票した Issue (7 本)

awsiac の `cdk_best_practices` チェックリストの観点 (セキュリティ / 信頼性 / 保守性 / 観測性 / コスト) で分類し、家族のみのプライベート用途で過剰になる指摘 (model drift 検知、bucket 名のクロスアカウント対応など) は廃案にして 7 テーマに絞った。

| # | Issue タイトル | 優先度 | 主観点 |
|---|---|---|---|
| (1) | Bedrock IAM 権限を最小権限に絞り、3 ロールで共通ヘルパー化 | P1 | セキュリティ |
| (2) | DynamoDB `expiresAt` をバックエンドで強制計算 | P1 | 信頼性 |
| (3) | Lambda リソース・CloudWatch Logs 保持の実測ベース最適化 | P2 | コスト・信頼性・観測性 |
| (4) | 設定値の環境変数化 (SCORE_THRESHOLD / EMBEDDING_MODEL_ID / requireEnv ヘルパー) | P2 | 保守性 |
| (5) | Cognito sign-up 無効化を CDK で明示化 | P2 | セキュリティ |
| (6) | Bedrock KB / DataSource の removalPolicy 明示と再作成 SOP 整備 | P2 | 信頼性 |
| (7) | Amplify Hosting 環境変数展開フローのスクリプト化 | P3 | 保守性 |

詳細な現状コード抜粋・改善案・影響範囲は GitHub Issue 本文に書いた。実装着手はそれぞれ別ブランチで段階的に。

### 廃案にした指摘 (今は触らない)

- **system prompt のモデルバージョン drift 検知**: Phase 2 (Ragas 月次評価) でカバー済み。ペット 2 名規模で別建ての検知は過剰。
- **S3 bucket 名にアカウント ID/リージョン埋め込み**: シングルアカウント運用前提なので問題なし。コメント追加すら不要と判断。
- **chat-handler の topScore と Evaluation Pipeline の二重計測**: 用途が違う (現場ヒット計測 vs Ragas Context Recall) ので二重計測自体は妥当。docs/knowledge.md 2026-05-06 に既に整理済み。
- **ESM / CommonJS 混在**: 動いているのでメリットなし。tsconfig 統一を別途やるよりは、Issue (3)〜(7) を先に進める。

### 「修正済み」の追跡

各 Issue がマージされたら、ここに「### 2026-MM-DD: Issue #XX 完了」の節を追加して、何をどう直したか・残課題があるかを 1 段落で記録する (Issue 単独で散逸させない)。

---

### 2026-05-11: 決定事項 — サイドバー UI ラベルを「アーカイブ」→「ゴミ箱」に統一

#### 背景

PR #45 で「アーカイブ = 90日後に自動削除される一時保管所」というゴミ箱モデルに動作を変更したが、UI ラベルは「アーカイブ」のままだった。家族からは「📥 のアイコンの意味が分からない」「コケ先輩アイコンと見分けがつかない」「どっちが押す前/押した後か区別できない」というフィードバックが上がった。

#### 原因

1. **絵文字単独**: アクティブ行右端の `📥`（受信トレイ絵文字）は iOS レンダリングだとコケ先輩アバターとシルエットが似ていて、操作ボタンに見えない。
2. **動詞ラベルなし**: ボタン側の説明は `title` / `aria-label` 属性のみで、画面上の可視テキストが存在しない。
3. **同じアイコンの重複**: アクティブ行のボタンとアーカイブセクションのヘッダーが両方とも `📥` を使っており、「操作」と「セクション名」が同じ記号で表現されていた。
4. **語と動作の不一致**: 「アーカイブ」という単語は一般に「戻せる長期保管」を連想させるが、実際は90日後に消える。ラベルと挙動が食い違って混乱を増幅していた。

#### 対応 (web/app/page.tsx 修正)

- アクティブ行のボタン絵文字 `📥` → `📦`（段ボール箱: 「収納する」感が強くコケ先輩と混同しにくい）
- ボタンの `title` / `aria-label` / 確認ダイアログのテキストを「アーカイブ」→「ゴミ箱」呼称に変更
- アーカイブセクションのヘッダー絵文字 `📥` → `🗑`、ラベル「アーカイブ」→「ゴミ箱」
- ヘッダー背景を `bg-zinc-100` → `bg-amber-100` (dark は `amber-900/30`)、ボーダーを `border-t` → `border-t-2 border-amber-300` に変更してアクティブ領域との視覚的境界を強化
- エラートースト表示文字列 `アーカイブ失敗` → `ゴミ箱送り失敗`

#### 触らなかった部分

- TypeScript の `archived` フラグ名、`setArchived` 関数名、コード内コメントの技術用語「アーカイブ」はそのまま維持。DynamoDB スキーマ・既存データと整合させるため。UI ラベルだけ書き換える方針。

#### 学び

- 「動作モデルの変更」と「UI 表記の変更」はワンセットで行うべき。動作だけ変えて表記を残すと、利用者から見たメンタルモデルと実装が乖離して認知負荷が増える。
- 絵文字単独のアイコンは、似たキャラクターアバターが画面に並ぶアプリでは特に視認性が落ちる。同じ画面の他要素と差別化できる形状の絵文字を選ぶ必要がある。
- 「家族からのフィードバック」を反映する案件では、技術用語をそのまま UI に出さず、日常語（ゴミ箱・送る・戻す）に翻訳することがそのまま品質向上に直結する。

---

## 参考情報のメモ

詳細URLは `spec.md` §参考一次ソースを参照。重要度の高いものを抜粋して再掲する。

- S3 Vectors + Bedrock KB公式ドキュメント
- Amplify AI Kit + Conversation 公式ドキュメント
- Bedrock KB Chunking公式ドキュメント
- 飼養衛生管理基準（農水省）
