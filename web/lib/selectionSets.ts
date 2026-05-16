// Amplify Data v2 で `a.model()` の `list()` / `get()` を呼ぶときに使う selection set。
//
// 背景: Amplify Data v2 のクライアントは optional スカラーフィールド (`a.boolean()`,
// `a.float()` のような required 指定なし) を `node_modules` / `amplify_outputs.json`
// のキャッシュ状況によって selection set から脱落させることがある。脱落すると
// AppSync 応答にフィールドが含まれず、クライアント側で undefined になって `?? null`
// などのフォールバックで誤動作する (2026-05-16 本番障害の原因)。
//
// 関連 Issue: aws-amplify/amplify-js#12987, amplify-category-api#2368, amplify-data#457
//
// 対策として、`list()` / `get()` 呼び出しでは必ずこの定数を `selectionSet` に渡し、
// 「このフィールドを必ず取る」と明示する。スキーマに新フィールドを追加したらこの
// 配列にも追加すること。

export const CONVERSATION_FIELDS = [
    'id',
    'title',
    'summary',
    'summarizedCount',
    'expiresAt',
    'archived',
    'createdAt',
    'updatedAt',
] as const;

export const MESSAGE_FIELDS = [
    'id',
    'conversationId',
    'role',
    'content',
    'citations',
    'hasKbResults',
    'topScore',
    'createdAt',
] as const;
