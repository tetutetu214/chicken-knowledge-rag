import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { chatHandler } from './functions/chat-handler/resource';
import { summarizeHandler } from './functions/summarize-handler/resource';
import { createIamResources } from './infra/iam';
import { createBudgetWithHardStop } from './infra/budget';
import { createStorageResources } from './infra/storage';
import { createKnowledgeBase } from './infra/knowledge-base';
import { createHosting } from './infra/hosting';

/**
 * 環境変数から必須値を取得する。未設定なら明示的にエラーで止める。
 *
 * デプロイ前に以下を実行して環境変数をロードすること:
 *   source ~/.secrets/chicken-knowledge-rag.env
 */
const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(
            `環境変数 ${name} が未設定。`
            + ' source ~/.secrets/chicken-knowledge-rag.env を実行してから再試行してください。',
        );
    }
    return value;
};

const notificationEmail = requireEnv('NOTIFICATION_EMAIL');
const budgetLimitUsd = parseInt(requireEnv('BUDGET_MONTHLY_LIMIT_USD'), 10);
const hostingBranchName = requireEnv('HOSTING_BRANCH_NAME');
const amplifyOutputsGzB64 = requireEnv('AMPLIFY_OUTPUTS_GZ_B64');

// Amplify Gen2 のベース定義 (auth: Cognito, data: AppSync + DynamoDB, functions: chat / summarize)
const backend = defineBackend({
    auth,
    data,
    chatHandler,
    summarizeHandler,
});

// CDK 拡張: IAM / Budget 等のインフラリソースを同じ Stack に追加
const infraStack = backend.createStack('ChickenRagInfra');

const { bedrockDenyPolicy, kbServiceRole, lambdaRole } = createIamResources(
    infraStack,
);

createBudgetWithHardStop(infraStack, {
    notificationEmail,
    monthlyLimitUsd: budgetLimitUsd,
    bedrockDenyPolicy,
    hardStopTargetRole: lambdaRole,
});

// S3 バケット 3 種 (docs / knowledge / image)
const { docsBucket, knowledgeBucket, imageBucket } = createStorageResources(
    infraStack,
);

// Bedrock KB サービスロールに docsBucket への読み取り権限を付与
docsBucket.grantRead(kbServiceRole);

// Bedrock Knowledge Base + S3 Vectors + DataSource (Hierarchical chunking)
const { vectorBucket, vectorIndex, knowledgeBase, dataSource } =
    createKnowledgeBase(infraStack, {
        docsBucket,
        kbServiceRole,
    });

// 会話 API: AppSync Direct Lambda Resolver (Cognito 認証必須)
// 回答生成モデルは JP Inference Profile (Claude Haiku 4.5、CRIS必須)
const region = cdk.Stack.of(infraStack).region;
const accountId = cdk.Stack.of(infraStack).account;
const conversationModelId = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

// Bedrock 呼び出し権限を Lambda 実行ロールに付与する共通ヘルパ。
// chat / summarize 両方が Inference Profile 経由で Haiku 4.5 を呼ぶため共有。
const grantBedrockInvoke = (role: iam.IRole): void => {
    role.addToPrincipalPolicy(
        new iam.PolicyStatement({
            sid: 'BedrockInferenceProfileInvoke',
            actions: [
                'bedrock:InvokeModel',
                'bedrock:GetInferenceProfile',
                'bedrock:UseInferenceProfile',
            ],
            resources: [
                `arn:aws:bedrock:${region}:${accountId}:inference-profile/*`,
                `arn:aws:bedrock:${region}::foundation-model/*`,
                // CRIS は他リージョンの foundation-model も呼ぶため広めに許可
                'arn:aws:bedrock:*::foundation-model/*',
            ],
        }),
    );
};

// === chat Lambda ===
const chatLambda = backend.chatHandler.resources.lambda as lambda.Function;
chatLambda.addEnvironment(
    'KNOWLEDGE_BASE_ID',
    knowledgeBase.attrKnowledgeBaseId,
);
chatLambda.addEnvironment('MODEL_ID', conversationModelId);

const chatLambdaRole = chatLambda.role;
if (!chatLambdaRole) {
    throw new Error('chatHandler の Lambda 実行ロールが未生成');
}

chatLambdaRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
        sid: 'BedrockKnowledgeBaseQuery',
        actions: ['bedrock:Retrieve'],
        resources: [
            `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*`,
        ],
    }),
);
grantBedrockInvoke(chatLambdaRole);

// chat Lambda が KB 作成後に呼び出せるよう依存関係を追加
chatLambda.node.addDependency(knowledgeBase);

// === summarize Lambda ===
const summarizeLambda = backend.summarizeHandler.resources.lambda as lambda.Function;
summarizeLambda.addEnvironment('MODEL_ID', conversationModelId);

const summarizeLambdaRole = summarizeLambda.role;
if (!summarizeLambdaRole) {
    throw new Error('summarizeHandler の Lambda 実行ロールが未生成');
}
grantBedrockInvoke(summarizeLambdaRole);

// === DynamoDB TTL 設定 (Conversation / Message) ===
// Amplify Gen2 が a.model() から生成する AmplifyDynamoDBTable カスタムリソースに対して、
// CDK escape hatch で timeToLiveAttribute を後付けで設定する。
// 属性名 expiresAt (Unix epoch seconds) は a.model() で integer 型として宣言済み。
// レコード作成時にフロント側で「90日後の epoch 秒」をセットすれば自動削除される。
const cfnTables = backend.data.resources.cfnResources.amplifyDynamoDbTables;
for (const modelName of ['Conversation', 'Message']) {
    const cfnTable = cfnTables[modelName];
    if (cfnTable) {
        cfnTable.timeToLiveAttribute = {
            attributeName: 'expiresAt',
            enabled: true,
        };
    }
}

// === Amplify Hosting (静的サイト配信) ===
// GitHub PAT は Secrets Manager (chicken-rag/github-token) から CDK 内で参照する。
// AMPLIFY_OUTPUTS_B64 はビルド時に preBuild フェーズで amplify_outputs.json に展開される。
const { app: hostingApp } = createHosting(infraStack, {
    githubOwner: 'tetutetu214',
    githubRepo: 'chicken-knowledge-rag',
    githubTokenSecretName: 'chicken-rag/github-token',
    branchName: hostingBranchName,
    amplifyOutputsGzB64,
});

// 後続 Step で参照する ARN を amplify_outputs.json に書き出す
backend.addOutput({
    custom: {
        kbServiceRoleArn: kbServiceRole.roleArn,
        lambdaRoleArn: lambdaRole.roleArn,
        bedrockDenyPolicyArn: bedrockDenyPolicy.managedPolicyArn,
        docsBucketName: docsBucket.bucketName,
        knowledgeBucketName: knowledgeBucket.bucketName,
        imageBucketName: imageBucket.bucketName,
        vectorBucketArn: vectorBucket.attrVectorBucketArn,
        vectorIndexArn: vectorIndex.attrIndexArn,
        knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
        dataSourceId: dataSource.attrDataSourceId,
        chatFunctionName: chatLambda.functionName,
        summarizeFunctionName: summarizeLambda.functionName,
        amplifyHostingAppId: hostingApp.appId,
        amplifyHostingDefaultDomain: hostingApp.defaultDomain,
    },
});
