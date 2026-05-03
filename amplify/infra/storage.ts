import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

/**
 * 本プロジェクトで使う S3 バケット群の定義。
 *
 * - docsBucket: 公的マニュアル・論文の原本 (PDF)。Bedrock KB のデータソースとなる。
 * - knowledgeBucket: 現場ナレッジ Markdown。Phase 1.5 でナレッジ投稿フォームから保存される。
 * - imageBucket: 鶏の症状写真等 (Phase 2 用に予約)。
 *
 * 共通設定:
 * - パブリックアクセス全ブロック (機微情報を含む可能性のため)
 * - SSE-S3 暗号化 (AWS マネージドキー)
 * - HTTPS のみ許可 (enforceSSL)
 * - バージョニング有効 (誤上書き対策、Bedrock KB は最新バージョンを参照)
 * - PoC 段階は RemovalPolicy: DESTROY + autoDeleteObjects: true
 *   (Sandbox 削除時にバケットごと消えるよう設定。本番化時は RETAIN へ変更)
 */
export interface StorageResources {
    docsBucket: s3.Bucket;
    knowledgeBucket: s3.Bucket;
    imageBucket: s3.Bucket;
}

const buildCommonBucketProps = (): Omit<s3.BucketProps, 'bucketName'> => ({
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    versioned: true,
    // PoC: Stack 削除時にバケットごと消す。本番化時は RETAIN に変更し autoDeleteObjects も外す。
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
});

export const createStorageResources = (scope: Construct): StorageResources => {
    // CDK 実行時にアカウント ID を解決する (ハードコードしない)
    const accountId = cdk.Stack.of(scope).account;
    const region = cdk.Stack.of(scope).region;

    const commonProps = buildCommonBucketProps();

    // 公的マニュアル・論文の原本 (Bedrock KB データソース)
    const docsBucket = new s3.Bucket(scope, 'DocsBucket', {
        ...commonProps,
        bucketName: `chicken-rag-docs-${accountId}-${region}`,
    });

    // 現場ナレッジ Markdown (Phase 1.5 で利用)
    const knowledgeBucket = new s3.Bucket(scope, 'KnowledgeBucket', {
        ...commonProps,
        bucketName: `chicken-rag-knowledge-${accountId}-${region}`,
    });

    // 鶏の症状写真 (Phase 2 用に予約)
    const imageBucket = new s3.Bucket(scope, 'ImageBucket', {
        ...commonProps,
        bucketName: `chicken-rag-image-${accountId}-${region}`,
    });

    return { docsBucket, knowledgeBucket, imageBucket };
};
