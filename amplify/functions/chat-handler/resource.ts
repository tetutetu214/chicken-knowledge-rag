/**
 * chat Lambda の Amplify Gen2 リソース定義。
 *
 * 環境変数 (KNOWLEDGE_BASE_ID / MODEL_ARN / MODEL_ID) と IAM 権限は
 * amplify/backend.ts 側で動的に設定する (CFn token を渡すため)。
 */
import { defineFunction } from '@aws-amplify/backend';

export const chatHandler = defineFunction({
    name: 'chatHandler',
    entry: './handler.ts',
    timeoutSeconds: 60,
    memoryMB: 512,
    // CloudWatch Logs 保持期間を 90 日に統一 (Issue #30 縮小スコープ)。
    // DynamoDB 会話履歴の TTL 90 日と整合させる (PII 保管期間ポリシーの揃え)。
    // Amplify Gen2 は新規 LogGroup を CDK で作って Lambda が書き込むよう設定するため、
    // sandbox 過去実行で自動作成された旧 LogGroup (/aws/lambda/<func-name>...) は孤児化する。
    // 旧 LogGroup の手動 cleanup は docs/operations.md「Lambda LogGroup 旧ログ cleanup」参照。
    logging: {
        retention: '3 months',
    },
});
