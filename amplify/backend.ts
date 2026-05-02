import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { createIamResources } from './infra/iam';
import { createBudgetWithHardStop } from './infra/budget';
import { createStorageResources } from './infra/storage';

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
// (Step 2 で Bedrock KB がこのバケットをデータソースとして使うため)
docsBucket.grantRead(kbServiceRole);

// 後続 Step で参照する ARN を amplify_outputs.json に書き出す
backend.addOutput({
    custom: {
        kbServiceRoleArn: kbServiceRole.roleArn,
        lambdaRoleArn: lambdaRole.roleArn,
        bedrockDenyPolicyArn: bedrockDenyPolicy.managedPolicyArn,
        docsBucketName: docsBucket.bucketName,
        knowledgeBucketName: knowledgeBucket.bucketName,
        imageBucketName: imageBucket.bucketName,
    },
});
