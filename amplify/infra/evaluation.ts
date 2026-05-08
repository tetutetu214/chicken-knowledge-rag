/**
 * Ragas 評価パイプライン (Issue #17) のインフラ定義。
 *
 * 構成:
 * - EvaluationBucket: S3。testset/v1.json と results/{runId}.json を保持
 * - EvaluationResultsTable: DynamoDB。PK=runId, SK=metricName でスコアを格納
 * - EvaluationHandler: Python 3.12 + Lambda Container Image (Ragas 依存サイズ対応)
 * - EvaluationSchedule: EventBridge Scheduler。月次 JST 09:00 起動
 *
 * 応答生成方式は「案 C」: evaluation-handler から chat-handler Lambda を直接 invoke
 * (本番一致のため。詳細は docs/knowledge.md 参照)。
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';

// ESM では __dirname が無いので import.meta.url から導出する
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface EvaluationProps {
    /** Bedrock KB ID。Retrieve API 呼び出しに使う */
    knowledgeBaseId: string;
    /** chat-handler Lambda 関数名 (invoke 対象) */
    chatHandlerFunctionName: string;
    /** chat-handler Lambda ARN (IAM 権限付与用) */
    chatHandlerFunctionArn: string;
    /** ジャッジ LLM のモデル ID (例: apac.amazon.nova-pro-v1:0) */
    modelId: string;
}

export interface EvaluationResources {
    evaluationBucket: s3.Bucket;
    resultsTable: dynamodb.Table;
    evaluationLambda: lambda.DockerImageFunction;
    schedule: scheduler.CfnSchedule;
}

export const createEvaluationPipeline = (
    scope: Construct,
    props: EvaluationProps,
): EvaluationResources => {
    const region = cdk.Stack.of(scope).region;
    const accountId = cdk.Stack.of(scope).account;

    // 1. S3 evaluation-bucket
    // 共通設定 (storage.ts と同じ): SSE-S3 / public block / SSL only / versioned / PoC は DESTROY
    const evaluationBucket = new s3.Bucket(scope, 'EvaluationBucket', {
        bucketName: `chicken-rag-evaluation-${accountId}-${region}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
    });

    // 2. DynamoDB EvaluationResults テーブル
    // PK=runId / SK=metricName。月1回バッチなのでオンデマンド (固定費を払いたくない)
    const resultsTable = new dynamodb.Table(scope, 'EvaluationResultsTable', {
        tableName: 'EvaluationResults',
        partitionKey: {
            name: 'runId',
            type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
            name: 'metricName',
            type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. evaluation-handler Lambda (Python 3.12 + Container Image)
    // Ragas + langchain-aws + numpy/pandas で zip 上限 250MB を超えるため Container 必須。
    // タイムアウト 15分: 15問 × (chat-handler invoke + Ragas 4指標 LLM ジャッジ) で
    // 数分かかる想定 (実測してから絞る)。
    const dockerContextPath = join(
        __dirname,
        '..',
        'functions',
        'evaluation-handler',
    );
    const evaluationLambda = new lambda.DockerImageFunction(
        scope,
        'EvaluationHandler',
        {
            functionName: 'chicken-rag-evaluation-handler',
            code: lambda.DockerImageCode.fromImageAsset(dockerContextPath),
            timeout: cdk.Duration.minutes(15),
            memorySize: 2048,
            environment: {
                KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
                MODEL_ID: props.modelId,
                CHAT_HANDLER_FUNCTION_NAME: props.chatHandlerFunctionName,
                EVALUATION_BUCKET: evaluationBucket.bucketName,
                TESTSET_KEY: 'testset/v1.json',
                RESULTS_TABLE_NAME: resultsTable.tableName,
            },
        },
    );

    // 4. IAM 権限付与
    // S3 (testset 読込 + results アーカイブ) と DynamoDB (write)
    evaluationBucket.grantReadWrite(evaluationLambda);
    resultsTable.grantWriteData(evaluationLambda);

    // chat-handler Lambda の直接 invoke 権限
    evaluationLambda.addToRolePolicy(
        new iam.PolicyStatement({
            sid: 'InvokeChatHandler',
            actions: ['lambda:InvokeFunction'],
            resources: [props.chatHandlerFunctionArn],
        }),
    );

    // Bedrock KB Retrieve 権限 (chat-handler と並行 Retrieve するため)
    evaluationLambda.addToRolePolicy(
        new iam.PolicyStatement({
            sid: 'BedrockKbRetrieve',
            actions: ['bedrock:Retrieve'],
            resources: [
                `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*`,
            ],
        }),
    );

    // Bedrock InvokeModel 権限 (Ragas のジャッジ LLM = Sonnet 4.6 / Embedding = Titan V2)
    // Inference Profile 経由のため Foundation Model ARN もカバー (chat-handler と同パターン)
    evaluationLambda.addToRolePolicy(
        new iam.PolicyStatement({
            sid: 'BedrockInvokeForRagas',
            actions: [
                'bedrock:InvokeModel',
                'bedrock:GetInferenceProfile',
                'bedrock:UseInferenceProfile',
            ],
            resources: [
                `arn:aws:bedrock:${region}:${accountId}:inference-profile/*`,
                `arn:aws:bedrock:${region}::foundation-model/*`,
                'arn:aws:bedrock:*::foundation-model/*',
                'arn:aws:bedrock:::foundation-model/*',
            ],
        }),
    );

    // 5. EventBridge Scheduler (月次自動実行)
    // 毎月1日 09:00 JST。Scheduler は cron(分 時 日 月 曜日 年) 形式で
    // scheduleExpressionTimezone=Asia/Tokyo を指定すれば JST で評価される。
    const schedulerRole = new iam.Role(scope, 'EvaluationSchedulerRole', {
        assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [evaluationLambda.functionArn],
        }),
    );

    const schedule = new scheduler.CfnSchedule(scope, 'EvaluationSchedule', {
        name: 'chicken-rag-monthly-evaluation',
        scheduleExpression: 'cron(0 9 1 * ? *)',
        scheduleExpressionTimezone: 'Asia/Tokyo',
        flexibleTimeWindow: { mode: 'OFF' },
        target: {
            arn: evaluationLambda.functionArn,
            roleArn: schedulerRole.roleArn,
        },
        state: 'ENABLED',
    });

    return { evaluationBucket, resultsTable, evaluationLambda, schedule };
};
