import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * 本プロジェクトで使う IAM リソース群の定義。
 *
 * - bedrockDenyPolicy: AWS Budgets Actions が予算超過時にアタッチする
 *   ハードストップ用のDenyポリシー。Bedrock呼び出しを止める。
 * - kbServiceRole: Bedrock Knowledge Base 自身が S3 と Embedding モデルを
 *   呼び出すためのサービスロール(信頼: bedrock.amazonaws.com)。
 * - lambdaRole: Lambda(Conversation Handler)が Bedrock RetrieveAndGenerate
 *   を呼ぶための実行ロール(信頼: lambda.amazonaws.com)。ハードストップ対象。
 */
export interface IamResources {
    bedrockDenyPolicy: iam.ManagedPolicy;
    kbServiceRole: iam.Role;
    lambdaRole: iam.Role;
}

export const createIamResources = (scope: Construct): IamResources => {
    // ハードストップ用 Deny ポリシー
    // Budgets Actions が Lambda 実行ロールにアタッチして Bedrock 呼び出しを停止する
    const bedrockDenyPolicy = new iam.ManagedPolicy(scope, 'BedrockDenyPolicy', {
        managedPolicyName: 'chicken-rag-bedrock-deny',
        description:
            '予算超過時にアタッチして Bedrock 呼び出し系 API を停止するポリシー',
        statements: [
            new iam.PolicyStatement({
                sid: 'DenyBedrockInvocation',
                effect: iam.Effect.DENY,
                actions: [
                    'bedrock:InvokeModel',
                    'bedrock:InvokeModelWithResponseStream',
                    'bedrock:Retrieve',
                    'bedrock:RetrieveAndGenerate',
                    'bedrock:Converse',
                    'bedrock:ConverseStream',
                    'bedrock:InvokeAgent',
                ],
                resources: ['*'],
            }),
        ],
    });

    // Bedrock Knowledge Base サービスロール
    // KB 自身が S3 と Foundation Model を呼ぶために必要
    // 具体的な権限は Step 2 で S3 バケットと Embedding モデル ARN を確定後に追加する
    const kbServiceRole = new iam.Role(scope, 'BedrockKbServiceRole', {
        roleName: 'chicken-rag-bedrock-kb-role',
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        description:
            'Bedrock Knowledge Base が S3 と Embedding モデルを呼ぶためのロール',
    });

    // Lambda 実行ロール (Conversation Handler 用)
    // ハードストップ対象。Bedrock RetrieveAndGenerate 権限は Step 4 で追加する。
    const lambdaRole = new iam.Role(scope, 'LambdaExecutionRole', {
        roleName: 'chicken-rag-lambda-role',
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        description:
            'Conversation Lambda の実行ロール (Bedrock 呼び出し用、ハードストップ対象)',
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                'service-role/AWSLambdaBasicExecutionRole',
            ),
        ],
    });

    return { bedrockDenyPolicy, kbServiceRole, lambdaRole };
};
