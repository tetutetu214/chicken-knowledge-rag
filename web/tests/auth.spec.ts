import { expect, test } from '@playwright/test';

// 未認証時の自前サインイン画面ガード。
// このファイルは playwright.config.ts の chromium-anon project (storageState なし)
// だけが実行する。chromium-authed project では実行されない。
//
// 2026-05-19: Amplify UI Authenticator を捨てて自前 SignInScreen に切替済み。
// パスキー優先 UX のため、パスワード入力欄は初期非表示で fallback リンク経由で開く。

test.describe('自前サインイン画面ガード', () => {
    test('未認証時はメアド入力とパスキーボタンが表示される', async ({
        page,
    }) => {
        await page.goto('/');

        // メアド入力欄
        await expect(
            page.getByRole('textbox', { name: /メールアドレス/ }),
        ).toBeVisible({ timeout: 10_000 });

        // メインの「🔑 パスキーでサインイン」ボタン
        await expect(
            page.getByRole('button', { name: /パスキーでサインイン/ }),
        ).toBeVisible();

        // パスワードでサインインへのフォールバックリンク (初期は折りたたみ)
        await expect(
            page.getByRole('link', { name: /パスワードでサインイン/ }),
        ).toBeVisible();

        // パスワード入力欄は初期非表示
        await expect(
            page.getByRole('textbox', { name: /^パスワード$/ }),
        ).toHaveCount(0);

        // ログイン後 UI (サインアウトボタン) は出ない
        await expect(
            page.getByRole('button', { name: /サインアウト/ }),
        ).toHaveCount(0);
    });

    test('パスワードでサインインリンクを押すとパスワード入力欄が現れる', async ({
        page,
    }) => {
        await page.goto('/');

        await page
            .getByRole('link', { name: /パスワードでサインイン/ })
            .click();

        await expect(
            page.getByRole('textbox', { name: /^パスワード$/ }),
        ).toBeVisible();

        // 展開後は同じ文言の送信ボタン (role=button) も現れる
        await expect(
            page.getByRole('button', { name: /パスワードでサインイン/ }),
        ).toBeVisible();
    });
});
