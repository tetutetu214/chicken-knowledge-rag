/**
 * summarize Lambda の Amplify Gen2 リソース定義。
 *
 * 環境変数 (MODEL_ID) と IAM 権限は amplify/backend.ts 側で動的に設定する。
 */
import { defineFunction } from '@aws-amplify/backend';

export const summarizeHandler = defineFunction({
    name: 'summarizeHandler',
    entry: './handler.ts',
    timeoutSeconds: 60,
    memoryMB: 512,
    // CloudWatch Logs 保持期間を 90 日に統一 (Issue #30 縮小スコープ)。
    // DynamoDB 会話履歴の TTL 90 日と整合させる (PII 保管期間ポリシーの揃え)。
    // 詳細は chat-handler/resource.ts コメント参照。
    logging: {
        retention: '3 months',
    },
});
