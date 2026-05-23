import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { chatHandler } from './functions/chat-handler/resource';
import { summarizeHandler } from './functions/summarize-handler/resource';
import {
    createIamResources,
    grantKbRetrieve,
    grantNovaProInvoke,
} from './infra/iam';
import { createBudgetWithHardStop } from './infra/budget';
import { createStorageResources } from './infra/storage';
import { createKnowledgeBase } from './infra/knowledge-base';
import { createHosting } from './infra/hosting';
import { createEvaluationPipeline } from './infra/evaluation';

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
// 回答生成モデルは APAC Cross-region Inference Profile (Amazon Nova Pro、CRIS必須)。
// 旧 Sonnet 4.6 (global) から Nova Pro へ切替 (AWSクレジット原資、Issue #22 系の継続)。
const region = cdk.Stack.of(infraStack).region;
const accountId = cdk.Stack.of(infraStack).account;
const conversationModelId = 'apac.amazon.nova-pro-v1:0';

// Bedrock 呼び出し権限の付与は `amplify/infra/iam.ts` の grantNovaProInvoke /
// grantKbRetrieve ヘルパーに集約 (Issue #28、3 Lambda で同一定義を再利用するため)。

// === chat Lambda ===
const chatLambda = backend.chatHandler.resources.lambda as lambda.Function;
chatLambda.addEnvironment(
    'KNOWLEDGE_BASE_ID',
    knowledgeBase.attrKnowledgeBaseId,
);
chatLambda.addEnvironment('MODEL_ID', conversationModelId);
// KB ヒット判定の cosine 類似度閾値 (Issue #31、Lambda コンソールで運用調整可にする)。
// 2026-05-09 朝に 0.7 → 0.75 へ引き上げ。同日夜、家族から「鶏の正式名称 (topScore 0.734) や首の骨の数 (0.622)
// など KB に答えがある質問でも一般知識回答に振り分けられる」報告を受け 0.7 へ戻し。0.75 は L1 一般質問
// (実測 0.63 帯) や日常語/専門語の語彙ギャップがあるクエリ (例「首の骨」vs「頚椎」) を取りこぼし過ぎる。
chatLambda.addEnvironment('SCORE_THRESHOLD', '0.7');

const chatLambdaRole = chatLambda.role;
if (!chatLambdaRole) {
    throw new Error('chatHandler の Lambda 実行ロールが未生成');
}

grantKbRetrieve(chatLambdaRole, {
    region,
    accountId,
    knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
});
grantNovaProInvoke(chatLambdaRole, { region, accountId });

// chat Lambda が KB 作成後に呼び出せるよう依存関係を追加
chatLambda.node.addDependency(knowledgeBase);

// === summarize Lambda ===
const summarizeLambda = backend.summarizeHandler.resources.lambda as lambda.Function;
summarizeLambda.addEnvironment('MODEL_ID', conversationModelId);

const summarizeLambdaRole = summarizeLambda.role;
if (!summarizeLambdaRole) {
    throw new Error('summarizeHandler の Lambda 実行ロールが未生成');
}
grantNovaProInvoke(summarizeLambdaRole, { region, accountId });

// === Ragas 評価パイプライン (Issue #17) ===
// chat-handler を直接 invoke して本番一致の応答を測る (案 C、knowledge.md 参照)。
// Lambda Container Image で Ragas + langchain-aws + numpy/pandas を配備、
// EventBridge Scheduler で月次自動実行。
//
// 重要: 専用 nested stack (`ChickenRagEvaluation`) に配置する。
// infraStack に置くと function stack (chat/summarize Lambda) が infraStack の
// KB を参照する既存依存と組み合わさって循環依存 (CloudformationStackCircularDependencyError)
// になるため、evaluation だけ独立スタックにして「function/infra → evaluation」の
// 単方向依存にする。
const evaluationStack = backend.createStack('ChickenRagEvaluation');
const {
    evaluationBucket,
    resultsTable: evaluationResultsTable,
    evaluationLambda,
} = createEvaluationPipeline(evaluationStack, {
    knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
    chatHandlerFunctionName: chatLambda.functionName,
    chatHandlerFunctionArn: chatLambda.functionArn,
    modelId: conversationModelId,
});

// evaluation Lambda は KB と chat-handler に依存 (どちらも作成後でないと invoke 不可)
evaluationLambda.node.addDependency(knowledgeBase);
evaluationLambda.node.addDependency(chatLambda);

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
        evaluationBucketName: evaluationBucket.bucketName,
        evaluationResultsTableName: evaluationResultsTable.tableName,
        evaluationFunctionName: evaluationLambda.functionName,
        amplifyHostingAppId: hostingApp.appId,
        amplifyHostingDefaultDomain: hostingApp.defaultDomain,
    },
});
