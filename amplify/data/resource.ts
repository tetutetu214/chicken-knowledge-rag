import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { chatHandler } from '../functions/chat-handler/resource';
import { summarizeHandler } from '../functions/summarize-handler/resource';

/**
 * AppSync GraphQL スキーマ。
 *
 * モデル:
 * - Conversation: スレッド単位 (タイトル + 要約)。所有者ガード (allow.owner)。
 * - Message: スレッド内のメッセージ 1件。citations は JSON で柔軟に保持。
 *
 * カスタム操作:
 * - chat: Bedrock KB を引いて回答する Direct Lambda Resolver。
 * - summarize: 履歴を要約して Conversation.summary を更新する Lambda Resolver。
 *
 * 認証は Cognito User Pool のみ (defaultAuthorizationMode: userPool)。
 */
const schema = a.schema({
    Citation: a.customType({
        uri: a.string().required(),
        page: a.integer(),
    }),

    ChatResponse: a.customType({
        answer: a.string().required(),
        citations: a.ref('Citation').array(),
        hasKbResults: a.boolean().required(),
        // KB Retrieve top-K のうち最大コサイン類似度。Issue #16 KB不足領域分析の入口。
        // 0〜1.0、SCORE_THRESHOLD (0.75) 未満は KB根拠なし扱い。
        topScore: a.float(),
    }),

    SummarizeResponse: a.customType({
        summary: a.string().required(),
    }),

    Conversation: a
        .model({
            title: a.string().required(),
            // 過去履歴の要約。10件を超えるたびにフロントが summarize mutation を呼んで更新する。
            summary: a.string(),
            // 既に summary に含まれている古いメッセージの累積件数。
            // N - summarizedCount > 10 になったら summarize を発動し、新10件分を summary に統合する。
            summarizedCount: a.integer(),
            // DynamoDB TTL 属性 (Unix epoch seconds)。CDK escape hatch で TimeToLive を有効化する。
            expiresAt: a.integer(),
            // アーカイブ済みフラグ。true ならサイドバー下段の折りたたみセクションに表示。
            // 既存レコードは undefined のまま放置し、フロントで `archived !== true` をアクティブ扱いとする
            // (DynamoDB スキーマレス特性を活用、移行スクリプト不要)。
            archived: a.boolean(),
            messages: a.hasMany('Message', 'conversationId'),
        })
        .authorization((allow) => [allow.owner()]),

    Message: a
        .model({
            conversationId: a.id().required(),
            conversation: a.belongsTo('Conversation', 'conversationId'),
            // 'user' または 'assistant'。a.enum を使うと TypeScript の値生成が複雑化するため string で運用。
            role: a.string().required(),
            content: a.string().required(),
            // [{uri: string, page: number | null}] 構造を JSON で保持。
            citations: a.json(),
            hasKbResults: a.boolean(),
            // KB Retrieve top-K の最大コサイン類似度 (assistant メッセージのみ意味あり)。
            // Issue #16 Phase 2 で /insights ダッシュボードから集計する。
            topScore: a.float(),
            expiresAt: a.integer(),
        })
        .authorization((allow) => [allow.owner()]),

    chat: a
        .query()
        .arguments({
            question: a.string().required(),
            // 直近メッセージ履歴。[{role: 'user'|'assistant', content: string}] を JSON 文字列で渡す。
            // フロントが直近10件を切り出して送る。
            historyJson: a.string(),
            // Conversation.summary。これまでの会話の要約 (11件目以降から有効)。
            summary: a.string(),
        })
        .returns(a.ref('ChatResponse'))
        .handler(a.handler.function(chatHandler))
        .authorization((allow) => [allow.authenticated()]),

    summarize: a
        .mutation()
        .arguments({
            // 既存 summary (なければ空文字)。新メッセージを取り込んで更新する。
            existingSummary: a.string(),
            // 要約対象メッセージ群。[{role, content}] を JSON 文字列で渡す。
            messagesJson: a.string().required(),
        })
        .returns(a.ref('SummarizeResponse'))
        .handler(a.handler.function(summarizeHandler))
        .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool',
    },
});
