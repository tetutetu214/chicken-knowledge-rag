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

// APAC Nova Pro Inference Profile が routing するリージョン一覧。
// `aws bedrock get-inference-profile --inference-profile-identifier apac.amazon.nova-pro-v1:0`
// の models[] と一致させる。新リージョン追加で routing が増えたらここを更新する。
const APAC_NOVA_PRO_REGIONS = [
    'ap-northeast-1',
    'ap-northeast-2',
    'ap-northeast-3',
    'ap-south-1',
    'ap-southeast-1',
    'ap-southeast-2',
] as const;

const APAC_NOVA_PRO_PROFILE_ID = 'apac.amazon.nova-pro-v1:0';
const NOVA_PRO_FOUNDATION_MODEL_ID = 'amazon.nova-pro-v1:0';
const TITAN_EMBED_V2_FOUNDATION_MODEL_ID = 'amazon.titan-embed-text-v2:0';

/**
 * APAC Nova Pro Inference Profile を呼ぶための Bedrock 権限を Role に付与する。
 *
 * Inference Profile 経由の InvokeModel は、認可評価が
 * Inference Profile ARN と routing 先 Foundation Model ARN の両方に対して
 * 走るため、両方を明示的に Allow しないと AccessDeniedException で落ちる。
 */
export const grantNovaProInvoke = (
    role: iam.IRole,
    props: { region: string; accountId: string },
): void => {
    const foundationModelArns = APAC_NOVA_PRO_REGIONS.map(
        (r) => `arn:aws:bedrock:${r}::foundation-model/${NOVA_PRO_FOUNDATION_MODEL_ID}`,
    );
    role.addToPrincipalPolicy(
        new iam.PolicyStatement({
            sid: 'BedrockInvokeNovaProInferenceProfile',
            actions: [
                'bedrock:InvokeModel',
                'bedrock:GetInferenceProfile',
                'bedrock:UseInferenceProfile',
            ],
            resources: [
                `arn:aws:bedrock:${props.region}:${props.accountId}:inference-profile/${APAC_NOVA_PRO_PROFILE_ID}`,
                ...foundationModelArns,
            ],
        }),
    );
};

/**
 * Titan Embeddings V2 (Foundation Model 直接呼び出し) の権限を Role に付与する。
 * Ragas 評価で類似度計算に使う。リージョン固定 (CRIS 非対応)。
 */
export const grantTitanEmbedInvoke = (
    role: iam.IRole,
    props: { region: string },
): void => {
    role.addToPrincipalPolicy(
        new iam.PolicyStatement({
            sid: 'BedrockInvokeTitanEmbedV2',
            actions: ['bedrock:InvokeModel'],
            resources: [
                `arn:aws:bedrock:${props.region}::foundation-model/${TITAN_EMBED_V2_FOUNDATION_MODEL_ID}`,
            ],
        }),
    );
};

/**
 * Bedrock Knowledge Base の Retrieve 権限を、特定 KB ID に限定して Role に付与する。
 * `knowledge-base/*` で全 KB アクセス可だった状態を、本プロジェクトの KB ID 1 個に絞る。
 */
export const grantKbRetrieve = (
    role: iam.IRole,
    props: { region: string; accountId: string; knowledgeBaseId: string },
): void => {
    role.addToPrincipalPolicy(
        new iam.PolicyStatement({
            sid: 'BedrockKnowledgeBaseRetrieve',
            actions: ['bedrock:Retrieve'],
            resources: [
                `arn:aws:bedrock:${props.region}:${props.accountId}:knowledge-base/${props.knowledgeBaseId}`,
            ],
        }),
    );
};

export const createIamResources = (scope: Construct): IamResources => {
    // ハードストップ用 Deny ポリシー
    // Budgets Actions が Lambda 実行ロールにアタッチして Bedrock 呼び出しを停止する
    const bedrockDenyPolicy = new iam.ManagedPolicy(scope, 'BedrockDenyPolicy', {
        managedPolicyName: 'chicken-rag-bedrock-deny',
        // description プロパティは ASCII + Latin-1 のみ (IAM API制約) のため英語表記
        description:
            'Deny Bedrock invocation APIs (hard-stop, attached when budget exceeded)',
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
            'Bedrock Knowledge Base service role for S3 and embedding model access',
    });

    // Lambda 実行ロール (Conversation Handler 用)
    // ハードストップ対象。Bedrock RetrieveAndGenerate 権限は Step 4 で追加する。
    const lambdaRole = new iam.Role(scope, 'LambdaExecutionRole', {
        roleName: 'chicken-rag-lambda-role',
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        description:
            'Lambda execution role for Bedrock invocation (hard-stop target)',
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                'service-role/AWSLambdaBasicExecutionRole',
            ),
        ],
    });

    return { bedrockDenyPolicy, kbServiceRole, lambdaRole };
};
