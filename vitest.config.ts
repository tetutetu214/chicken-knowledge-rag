import { defineConfig } from 'vitest/config';

// Lambda 関数 (amplify/functions/) の純粋関数を対象とする単体テスト設定。
// フロント (web/) のテストは web/vitest.config.ts 側で別途実行する。
export default defineConfig({
    test: {
        environment: 'node',
        include: ['amplify/**/*.test.ts'],
        exclude: ['node_modules', 'web', '.amplify', 'evaluation'],
    },
});
