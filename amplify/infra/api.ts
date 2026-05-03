import * as path from 'path';
import { fileURLToPath } from 'url';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// Amplify Gen2 は ESM のため CommonJS の __dirname が使えない。
// import.meta.url から相当のパスを構築する。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 会話 API (スコープB) の定義。
 *
 * 構成:
 * - Lambda (Python 3.12) が Bedrock retrieve-and-generate を呼び出す
 * - Lambda Function URL (認証なし、CORS 許可) で curl から直接叩ける
 * - 認証付き API は Phase 1.5 で Amplify AI Kit (a.conversation()) に移行
 */
export interface ConversationApiProps {
    /** Bedrock KB ID (knowledge-base.ts の attrKnowledgeBaseId を渡す) */
    knowledgeBaseId: string;
    /** 回答生成モデルの Inference Profile ARN */
    modelArn: string;
    /** Lambda 実行ロール (ハードストップ対象) */
    lambdaRole: iam.Role;
}

export interface ConversationApiResources {
    fn: lambda.Function;
    fnUrl: lambda.FunctionUrl;
    invokePolicy: iam.ManagedPolicy;
}

export const createConversationApi = (
    scope: Construct,
    props: ConversationApiProps,
): ConversationApiResources => {
    const { knowledgeBaseId, modelArn, lambdaRole } = props;
    const region = cdk.Stack.of(scope).region;
    const accountId = cdk.Stack.of(scope).account;

    // Lambda が Bedrock を呼ぶための権限を ManagedPolicy として独立化。
    // ManagedPolicy は roles プロパティで Lambda 実行ロールに同時アタッチされる。
    // Lambda Function 作成時にこの Policy が先にアタッチされるよう addDependency で順序保証する。
    const invokePolicy = new iam.ManagedPolicy(scope, 'LambdaInvokePolicy', {
        managedPolicyName: 'chicken-rag-lambda-invoke',
        description:
            'Lambda permissions for Bedrock retrieve-and-generate via inference profile',
        roles: [lambdaRole],
        statements: [
            new iam.PolicyStatement({
                sid: 'BedrockKnowledgeBaseQuery',
                actions: [
                    'bedrock:Retrieve',
                    'bedrock:RetrieveAndGenerate',
                ],
                // KB は同一アカウント内
                resources: [
                    `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*`,
                ],
            }),
            new iam.PolicyStatement({
                sid: 'BedrockInferenceProfileInvoke',
                actions: [
                    'bedrock:InvokeModel',
                    // CRIS Inference Profile を使う場合、retrieve-and-generate API が
                    // 内部でこれらを呼ぶため明示的に許可する必要がある
                    'bedrock:GetInferenceProfile',
                    'bedrock:UseInferenceProfile',
                ],
                // Inference Profile (CRIS) と裏で呼ばれる Foundation Model 両方
                resources: [
                    `arn:aws:bedrock:${region}:${accountId}:inference-profile/*`,
                    `arn:aws:bedrock:${region}::foundation-model/*`,
                    // CRIS は他リージョンの foundation-model も呼ぶ可能性があるため広めに許可
                    `arn:aws:bedrock:*::foundation-model/*`,
                ],
            }),
        ],
    });

    // Lambda Function (Python 3.12)
    const fn = new lambda.Function(scope, 'ConversationHandler', {
        functionName: 'chicken-rag-conversation-handler',
        description:
            'Bedrock retrieve-and-generate handler invoked from Lambda Function URL',
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
            path.join(__dirname, '../../lambda/conversation_handler'),
        ),
        role: lambdaRole,
        timeout: cdk.Duration.seconds(60),
        memorySize: 256,
        environment: {
            KNOWLEDGE_BASE_ID: knowledgeBaseId,
            MODEL_ARN: modelArn,
        },
    });

    // ManagedPolicy が Lambda Function 作成前にアタッチされるよう順序を保証
    fn.node.addDependency(invokePolicy);

    // Function URL (認証なし、curl テスト用)
    // 本番では Cognito Authorizer 付き API Gateway / AppSync に移行予定
    const fnUrl = fn.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.NONE,
        cors: {
            allowedOrigins: ['*'],
            allowedMethods: [lambda.HttpMethod.POST],
            allowedHeaders: ['Content-Type'],
            maxAge: cdk.Duration.minutes(10),
        },
    });

    return { fn, fnUrl, invokePolicy };
};
