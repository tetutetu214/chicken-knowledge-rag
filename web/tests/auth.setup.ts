import { expect, test as setup } from '@playwright/test';
import path from 'path';

// Playwright の認証セットアップ。User1 (てつてつ本人) で Cognito にログインし、
// storageState を `playwright/.auth/user1.json` に保存する。以降のテストは
// `use: { storageState: ... }` でこれを読み込み、ログイン済みの状態から開始する。
//
// 必要環境変数 (~/.secrets/chicken-knowledge-rag.env で export):
//   - USER1_EMAIL
//   - USER1_PASSWORD

const authFile = path.join(__dirname, '..', 'playwright', '.auth', 'user1.json');

setup('User1 でログインして storageState を保存する', async ({ page }) => {
    const email = process.env.USER1_EMAIL;
    const password = process.env.USER1_PASSWORD;
    if (!email || !password) {
        throw new Error(
            'USER1_EMAIL / USER1_PASSWORD が未設定。'
                + ' `source ~/.secrets/chicken-knowledge-rag.env` を先に実行してください。',
        );
    }

    await page.goto('/');

    // Amplify UI Authenticator のサインインフォーム
    await page
        .getByRole('textbox', { name: /メールアドレス|Email/i })
        .fill(email);
    await page
        .getByRole('textbox', { name: /パスワード|Password/i })
        .fill(password);
    await page
        .getByRole('button', { name: /^サインイン$|^Sign in$/i })
        .click();

    // ログイン成功後、サイドバーのアプリ名 (Cocco RAG ロゴ) が表示される。
    // Amplify Authenticator のサインアウト後に Amplify が JWT 取得 → useAuthenticator が再描画する流れで
    // 数秒かかることがあるため timeout を長めにとる。
    await expect(
        page.getByRole('heading', { name: /Cocco RAG/i }),
    ).toBeVisible({ timeout: 20_000 });

    await page.context().storageState({ path: authFile });
});
