import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';

/**
 * Bedrock Knowledge Base + S3 Vectors の定義。
 *
 * 構成:
 * - VectorBucket: S3 Vectors のベクトル格納用バケット (Bedrock KB バックエンド)
 * - VectorIndex: 1024次元 / cosine 距離 / float32 (Titan V2 と整合)
 * - KnowledgeBase: Bedrock KB 本体 (storageType: S3_VECTORS)
 * - DataSource: docsBucket を Hierarchical chunking で取り込む
 *   (parent 1500 / child 300 / overlap 60 トークン — spec.md 準拠)
 *
 * 注意: チャンキング戦略はデータソース作成後に変更不可のため、初期設定が確定値。
 *
 * Embedding モデル: 既定は Titan Text Embeddings V2 (amazon.titan-embed-text-v2:0)
 * - 1024次元、最大8192トークン、100+言語対応
 * - 別途 AWS コンソールで Bedrock モデルアクセス有効化が必要
 * - モデル ID は `embeddingModelId` props で受け取る (Issue #31、~/.secrets/...env 経由)。
 *   **変更すると Bedrock KB が CFn Replacement で再作成される** (= 既存ベクトル全消去 +
 *   再 Ingestion 必要 + KB ID が変わるので Lambda env も更新必要)。気軽な切替ではなく
 *   「移行操作の可視化」が目的。
 */
export interface KnowledgeBaseProps {
    /** ドキュメント原本バケット (Bedrock KB のデータソース) */
    docsBucket: s3.Bucket;
    /** Bedrock KB が引き受けるサービスロール */
    kbServiceRole: iam.Role;
    /**
     * Bedrock Foundation Model ID (例: amazon.titan-embed-text-v2:0)。
     * VectorIndex の dimension/dataType と整合させる必要あり。変更は KB 再作成を伴う。
     */
    embeddingModelId: string;
}

export interface KnowledgeBaseResources {
    vectorBucket: s3vectors.CfnVectorBucket;
    vectorIndex: s3vectors.CfnIndex;
    knowledgeBase: bedrock.CfnKnowledgeBase;
    dataSource: bedrock.CfnDataSource;
}

export const createKnowledgeBase = (
    scope: Construct,
    props: KnowledgeBaseProps,
): KnowledgeBaseResources => {
    const { docsBucket, kbServiceRole, embeddingModelId } = props;
    const region = cdk.Stack.of(scope).region;
    const accountId = cdk.Stack.of(scope).account;

    // Embedding モデルの Foundation Model ARN (既定は Titan Text Embeddings V2)
    const embeddingModelArn =
        `arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`;

    // S3 Vectors VectorBucket (ベクトルデータ格納用)
    const vectorBucket = new s3vectors.CfnVectorBucket(scope, 'VectorBucket', {
        vectorBucketName: `chicken-rag-vectors-${accountId}-${region}`,
    });

    // S3 Vectors Index (1024d / cosine / float32)
    // 論理ID 'VectorIndexV2' / indexName 'chicken-rag-index-v2' は metadataConfiguration 追加に伴う作り直し用。
    // S3 Vectors の filterable メタデータ上限 (2048バイト) に Bedrock KB のチャンクテキストが
    // 引っかかるため、AMAZON_BEDROCK_TEXT / AMAZON_BEDROCK_METADATA を非フィルタ化する。
    const vectorIndex = new s3vectors.CfnIndex(scope, 'VectorIndexV2', {
        vectorBucketArn: vectorBucket.attrVectorBucketArn,
        indexName: 'chicken-rag-index-v2',
        dataType: 'float32',
        dimension: 1024,
        distanceMetric: 'cosine',
        metadataConfiguration: {
            nonFilterableMetadataKeys: [
                'AMAZON_BEDROCK_TEXT',
                'AMAZON_BEDROCK_METADATA',
            ],
        },
    });
    vectorIndex.addDependency(vectorBucket);

    // KB サービスロールに必要な権限を ManagedPolicy として作成し、
    // roles プロパティで同時アタッチすることで「Policy作成 → アタッチ完了」を1ステップで実行。
    // これに KB が依存することで、KB 作成時に必ず権限が伝播済みの状態を保証する。
    // (addToPolicy で DefaultPolicy を作る方式だと KB との依存関係が暗黙になり race condition の原因になった)
    const kbInvokePolicy = new iam.ManagedPolicy(scope, 'KbInvokePolicy', {
        managedPolicyName: 'chicken-rag-kb-invoke',
        description:
            'KB permissions for embedding model invocation and S3 Vectors access',
        roles: [kbServiceRole],
        statements: [
            new iam.PolicyStatement({
                sid: 'BedrockEmbeddingInvoke',
                actions: ['bedrock:InvokeModel'],
                resources: [embeddingModelArn],
            }),
            new iam.PolicyStatement({
                sid: 'S3VectorsAccess',
                actions: [
                    's3vectors:PutVectors',
                    's3vectors:QueryVectors',
                    's3vectors:GetVectors',
                    's3vectors:DeleteVectors',
                    's3vectors:ListVectors',
                    's3vectors:GetIndex',
                    's3vectors:GetVectorBucket',
                ],
                resources: [
                    vectorBucket.attrVectorBucketArn,
                    `${vectorBucket.attrVectorBucketArn}/index/*`,
                ],
            }),
        ],
    });

    // Bedrock Knowledge Base 本体 (S3 Vectors バックエンド)
    // -v2 サフィックス: VectorIndex 再作成に伴う KB Replacement 時、
    // 同名の旧KBがまだ存在している間に新KB作成しようとして衝突するのを回避する。
    const knowledgeBase = new bedrock.CfnKnowledgeBase(scope, 'KnowledgeBase', {
        name: 'chicken-knowledge-rag-kb-v2',
        roleArn: kbServiceRole.roleArn,
        knowledgeBaseConfiguration: {
            type: 'VECTOR',
            vectorKnowledgeBaseConfiguration: {
                embeddingModelArn,
            },
        },
        storageConfiguration: {
            type: 'S3_VECTORS',
            s3VectorsConfiguration: {
                vectorBucketArn: vectorBucket.attrVectorBucketArn,
                indexArn: vectorIndex.attrIndexArn,
            },
        },
    });
    knowledgeBase.addDependency(vectorIndex);
    // KB は ManagedPolicy のアタッチ完了後に作成されるよう依存を明示
    knowledgeBase.node.addDependency(kbInvokePolicy);

    // Data Source: docsBucket を Hierarchical chunking で取り込む
    // チャンキング設定は spec.md §3-3 準拠 (parent 1500 / child 300 / overlap 60)
    const dataSource = new bedrock.CfnDataSource(scope, 'DataSource', {
        knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
        name: 'chicken-rag-docs-datasource-v2',
        dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
                bucketArn: docsBucket.bucketArn,
            },
        },
        vectorIngestionConfiguration: {
            chunkingConfiguration: {
                chunkingStrategy: 'HIERARCHICAL',
                hierarchicalChunkingConfiguration: {
                    levelConfigurations: [
                        { maxTokens: 1500 },
                        { maxTokens: 300 },
                    ],
                    overlapTokens: 60,
                },
            },
        },
    });

    return { vectorBucket, vectorIndex, knowledgeBase, dataSource };
};
