import { defineConfig } from '@playwright/test';

/**
 * Playwright 設定。
 *
 * - webServer 設定で Playwright が `npm run dev` を起動・停止管理する。
 * - reuseExistingServer: 既に dev server が動いていれば再利用（手動起動時の便利機能）。
 * - timeout: Bedrock retrieve-and-generate は数秒〜十数秒かかるため 90秒に設定。
 */
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
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
});
