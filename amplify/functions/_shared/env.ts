/**
 * Lambda ランタイム共通: 必須環境変数の読み出しヘルパー (Issue #31)。
 *
 * 設計方針:
 * - 値が未設定 or 空文字なら **モジュール初期化時に即 throw** する。
 *   これにより Lambda コールドスタートの瞬間に CloudWatch Logs に出るので、
 *   handler が「silently 空文字で動いてしまう事故」(例: MODEL_ID 空文字でも
 *   Bedrock API に呼び出しが投げられて謎の InvalidArgumentException になる)
 *   を構造的に防げる。
 *
 * 使用例:
 *   const MODEL_ID = requireEnv('MODEL_ID');
 *   const KB_ID = requireEnv('KNOWLEDGE_BASE_ID');
 *
 * CDK synth 時 (`amplify/backend.ts` 内) の同名ヘルパーとは別物。
 * あちらは synth 実行時に process.env を見るもので、Lambda ランタイムには適用されない。
 */
export const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`環境変数 ${name} が未設定`);
    }
    return value;
};
