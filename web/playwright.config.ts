import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright 設定。
 *
 * - webServer 設定で Playwright が `npm run dev` を起動・停止管理する。
 * - reuseExistingServer: 既に dev server が動いていれば再利用 (手動起動時の便利機能)。
 * - timeout: Bedrock retrieve-and-generate は数秒〜十数秒かかるため 90秒。
 * - projects: 認証 setup project が先に走り storageState を共有する 2 段構成。
 *   - setup: auth.setup.ts のみを実行し Cognito ログイン → playwright/.auth/user1.json 保存。
 *   - chromium-authed: storageState を読み込んだ状態で本テスト群を実行。
 *   - chromium-anon: storageState なしで未認証ガードのテストを実行。
 */
const STORAGE_STATE = path.join(
    __dirname,
    'playwright',
    '.auth',
    'user1.json',
);

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    // 単一 Cognito ユーザを共有しているため、複数 worker が同時に Conversation を
    // 作成・削除すると相互干渉して baseActive 計測がズレる。順次実行で安定化。
    workers: 1,
    use: {
        baseURL: 'http://localhost:3000',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'chromium-authed',
            // auth.setup.ts (認証準備) と auth.spec.ts (未認証ガード) は除外
            testIgnore: ['**/auth.setup.ts', '**/auth.spec.ts'],
            use: {
                ...devices['Desktop Chrome'],
                storageState: STORAGE_STATE,
            },
            dependencies: ['setup'],
        },
        {
            // 未認証ガード専用 (storageState を読まない)
            name: 'chromium-anon',
            testMatch: '**/auth.spec.ts',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
