import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { chatHandler } from '../functions/chat-handler/resource';

/**
 * AppSync GraphQL スキーマ。
 *
 * - Citation / ChatResponse: chat クエリの戻り値の構造体
 * - chat: Bedrock KB を引いて回答する Direct Lambda Resolver
 *   認証は Cognito User Pool に通ったユーザーのみ呼び出し可能
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
    }),

    chat: a
        .query()
        .arguments({ question: a.string().required() })
        .returns(a.ref('ChatResponse'))
        .handler(a.handler.function(chatHandler))
        .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool',
    },
});
