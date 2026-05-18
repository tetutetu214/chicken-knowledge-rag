import { defineConfig } from 'vitest/config';

// Next.js 16 / React 19 のフロントエンドでは、Vitest 4 が標準で TS/ESM を扱える。
// 純粋関数 (lib/) の単体テストに用途を絞っているため、jsdom や React Testing Library は導入していない。
// UI レンダリング検証は Playwright E2E 側で担保する。
export default defineConfig({
    test: {
        environment: 'node',
        include: ['lib/**/*.test.ts', 'app/**/*.test.tsx'],
        // E2E の Playwright テスト (tests/) は Vitest から除外する。
        exclude: ['node_modules', 'tests', '.next', 'out'],
    },
});
