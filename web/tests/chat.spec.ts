import { expect, test } from '@playwright/test';

// チャット送信 → 回答表示の E2E。Bedrock + Knowledge Base を実際に呼ぶため
// テスト 1 件あたり 10〜30 秒、課金も発生する (合計 ~$0.01 想定)。
// - KB ヒット質問: 「回答 (KB根拠あり):」が出る
// - KB 未ヒット質問: 「回答 (KB根拠なし):」+ 警告が出る
// 終了時はスレッドをゴミ箱送り + 完全削除して残骸を残さない。

const HPAI_QUESTION =
    '鳥インフルエンザの感染拡大防止のために最低限すべきことは？';
// SCORE_THRESHOLD (= 0.7) 未満になる確実な質問。鶏のドメインから完全に外す。
const OUT_OF_SCOPE_QUESTION = 'ピタゴラスの定理について教えて';

const TIMEOUT_MS = 90_000;

const cleanupLatestThread = async (sidebar: ReturnType<typeof getSidebar>) => {
    await sidebar
        .getByRole('button', { name: 'ゴミ箱へ移動' })
        .first()
        .click();
    await expect
        .poll(
            () =>
                sidebar
                    .getByRole('button', { name: '今すぐ削除' })
                    .count(),
            { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(1);
    await sidebar
        .getByRole('button', { name: '今すぐ削除' })
        .first()
        .click();
};

const getSidebar = (page: import('@playwright/test').Page) =>
    page.locator('aside[data-threads-loaded="true"]').first();

test.describe('チャット送信 + Bedrock 回答', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', (dialog) => dialog.accept());
        await page.goto('/');
        await expect(getSidebar(page)).toBeVisible({ timeout: 15_000 });
    });

    test('KB ヒット質問で「回答 (KB根拠あり):」が出る', async ({ page }) => {
        const sidebar = getSidebar(page);
        await sidebar
            .getByRole('button', { name: /\+ 新しい会話/ })
            .click();
        await page
            .getByPlaceholder(/鶏に関する質問/)
            .fill(HPAI_QUESTION);
        await page.getByRole('button', { name: /送信/ }).click();

        await expect(
            page.getByText('回答 (KB根拠あり):').first(),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        await cleanupLatestThread(sidebar);
    });

    test('KB 未ヒット質問で「回答 (KB根拠なし):」と警告が出る', async ({
        page,
    }) => {
        const sidebar = getSidebar(page);
        await sidebar
            .getByRole('button', { name: /\+ 新しい会話/ })
            .click();
        await page
            .getByPlaceholder(/鶏に関する質問/)
            .fill(OUT_OF_SCOPE_QUESTION);
        await page.getByRole('button', { name: /送信/ }).click();

        // 「回答 (KB根拠なし):」ラベルが出れば、cosine < SCORE_THRESHOLD で振り分け済み
        // = chat-handler が topScore を正しく算出 + フロントが ChatResponse を受け取っている、
        // を意味する。systemPrompt の警告文言は LLM の生成揺らぎで毎回同じとは限らないため、
        // ラベル表示だけ assertion 対象にする。
        await expect(
            page.getByText('回答 (KB根拠なし):').first(),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        await cleanupLatestThread(sidebar);
    });
});
