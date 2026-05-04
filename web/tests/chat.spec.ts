import { test, expect } from '@playwright/test';

const HPAI_QUESTION =
    '鳥インフルエンザの感染拡大防止のために最低限すべきことは？';
const OUT_OF_SCOPE_QUESTION = '鶏の鳴き声を音楽にしたい';

test.describe('Cognito 認証ガード', () => {
    test('未認証時は Authenticator のサインイン画面が表示される', async ({ page }) => {
        await page.goto('/');

        // Amplify UI Authenticator のサインインフォームが表示される
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

        await page.screenshot({
            path: 'test-results/00-signin.png',
            fullPage: true,
        });
    });
});

// 以下のテストは認証必須化により未認証では到達不可。
// Phase 1.5 後半で Cognito JWT を Playwright の storageState に事前注入する仕組みを
// 入れた後に有効化する (現状は手動でブラウザ確認済み)。
test.describe.skip(
    'マルチスレッド UI (要認証、Phase 1.5 後半で JWT注入対応)',
    () => {
        test('初期表示: サイドバーと入力欄が表示される', async ({ page }) => {
            await page.goto('/');

            // サイドバータイトル
            await expect(
                page.getByRole('heading', { level: 1 }),
            ).toContainText('Chicken RAG');

            // 「+ 新しい会話」ボタン
            await expect(
                page.getByRole('button', { name: /新しい会話/ }),
            ).toBeVisible();

            // 入力欄 (placeholder)
            await expect(
                page.getByPlaceholder(/鶏に関する質問/),
            ).toBeVisible();

            await page.screenshot({
                path: 'test-results/01-initial.png',
                fullPage: true,
            });
        });

        test('新規スレッド作成 → KB範囲内の質問で引用付き回答 (HPAI)', async ({ page }) => {
            await page.goto('/');

            await page.getByRole('button', { name: /新しい会話/ }).click();
            await page.getByPlaceholder(/鶏に関する質問/).fill(HPAI_QUESTION);
            await page.getByRole('button', { name: /送信/ }).click();

            await expect(
                page.getByText('回答 (KB根拠あり):').first(),
            ).toBeVisible({ timeout: 60_000 });

            await expect(
                page.getByText(/HPAI防疫指針/).first(),
            ).toBeVisible({ timeout: 5_000 });

            await page.screenshot({
                path: 'test-results/02-hpai-answer.png',
                fullPage: true,
            });
        });

        test('KB範囲外の質問: アンバーラベルで警告付き回答', async ({ page }) => {
            await page.goto('/');

            await page.getByRole('button', { name: /新しい会話/ }).click();
            await page
                .getByPlaceholder(/鶏に関する質問/)
                .fill(OUT_OF_SCOPE_QUESTION);
            await page.getByRole('button', { name: /送信/ }).click();

            await expect(
                page.getByText('回答 (KB根拠なし):').first(),
            ).toBeVisible({ timeout: 60_000 });

            await expect(
                page.getByText(/参考資料にはありません/).first(),
            ).toBeVisible();

            await page.screenshot({
                path: 'test-results/03-out-of-scope.png',
                fullPage: true,
            });
        });

        test('スレッド切替: 別スレッドのメッセージが表示される', async ({ page }) => {
            await page.goto('/');

            // スレッドA作成 + 質問
            await page.getByRole('button', { name: /新しい会話/ }).click();
            await page
                .getByPlaceholder(/鶏に関する質問/)
                .fill('スレッドAの質問');
            await page.getByRole('button', { name: /送信/ }).click();
            await expect(
                page.getByText(/スレッドAの質問/).first(),
            ).toBeVisible({ timeout: 60_000 });

            // スレッドB作成 + 別の質問
            await page.getByRole('button', { name: /新しい会話/ }).click();
            await page
                .getByPlaceholder(/鶏に関する質問/)
                .fill('スレッドBの質問');
            await page.getByRole('button', { name: /送信/ }).click();
            await expect(
                page.getByText(/スレッドBの質問/).first(),
            ).toBeVisible({ timeout: 60_000 });

            // サイドバーにAB両方表示されている
            await expect(page.getByText(/スレッドAの質問/)).toHaveCount(2); // メイン + サイドバー両方
            await expect(page.getByText(/スレッドBの質問/)).toHaveCount(2);

            await page.screenshot({
                path: 'test-results/04-multi-thread.png',
                fullPage: true,
            });
        });
    },
);
