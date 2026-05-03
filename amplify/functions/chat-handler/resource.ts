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
});
