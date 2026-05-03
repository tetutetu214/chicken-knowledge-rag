import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { chatHandler } from './functions/chat-handler/resource';
import { createIamResources } from './infra/iam';
import { createBudgetWithHardStop } from './infra/budget';
import { createStorageResources } from './infra/storage';
import { createKnowledgeBase } from './infra/knowledge-base';

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

// Amplify Gen2 のベース定義 (auth: Cognito, data: AppSync + DynamoDB)
const backend = defineBackend({
    auth,
    data,
    chatHandler,
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
const conversationModelArn =
    `arn:aws:bedrock:${region}:${accountId}:inference-profile/${conversationModelId}`;

// Amplify が生成した chat Lambda 実行ロールに、Bedrock KB / Inference Profile 呼び出し権限を追加する。
// resources.lambda は IFunction として返るため、具象 Function 型に cast して addEnvironment を呼ぶ。
const chatLambda = backend.chatHandler.resources.lambda as lambda.Function;
chatLambda.addEnvironment('KNOWLEDGE_BASE_ID', knowledgeBase.attrKnowledgeBaseId);
chatLambda.addEnvironment('MODEL_ARN', conversationModelArn);
chatLambda.addEnvironment('MODEL_ID', conversationModelId);

const chatLambdaRole = chatLambda.role;
if (!chatLambdaRole) {
    throw new Error('chatHandler の Lambda 実行ロールが未生成');
}

chatLambdaRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
        sid: 'BedrockKnowledgeBaseQuery',
        actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
        resources: [
            `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*`,
        ],
    }),
);

chatLambdaRole.addToPrincipalPolicy(
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

// chat Lambda が KB 作成後に呼び出せるよう依存関係を追加
chatLambda.node.addDependency(knowledgeBase);

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
    },
});
