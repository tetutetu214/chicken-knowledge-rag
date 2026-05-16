import { expect, test } from '@playwright/test';

// 未認証時の Authenticator ガード。
// このファイルは playwright.config.ts の chromium-anon project (storageState なし)
// だけが実行する。chromium-authed project では実行されない。

test.describe('Cognito 認証ガード', () => {
    test('未認証時は Authenticator のサインイン画面が表示される', async ({
        page,
    }) => {
        await page.goto('/');

        // Amplify UI Authenticator のサインインフォーム
        await expect(
            page.getByRole('textbox', { name: /メールアドレス|Email/i }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.getByRole('textbox', { name: /パスワード|Password/i }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: /^サインイン$|^Sign in$/i }),
        ).toBeVisible();

        // hideSignUp 設定により「Create Account」タブが出ないことを確認
        await expect(
            page.getByRole('tab', { name: /Create Account|アカウントを作成/i }),
        ).toHaveCount(0);

        // 認証後ロゴ (Cocco RAG) は出ない
        await expect(
            page.getByRole('heading', { name: /Cocco RAG/i }),
        ).toHaveCount(0);
    });
});
