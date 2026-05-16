import { expect, test } from '@playwright/test';

// Issue #16 Phase 2 — `/insights` BI 画面の E2E スモーク。
//
// 確認目的:
// - 認証済み (storageState) で `/insights` を開けること
// - サマリー/月次グラフ/ヒストグラム/未解決一覧/CSV ボタンが揃って表示されること
// - サイドバーから `/insights` への導線リンクがクリックで遷移できること
//
// Amplify Data の loadInsights 完了は `main[data-insights-loaded="true"]` で待つ
// (空配列の初期描画を「ロード完了」と誤判定しないため。詳細は knowledge.md 2026-05-16 参照)。

const TIMEOUT_MS = 20_000;

test.describe('Insights ダッシュボード', () => {
    test('main ナビから /insights に遷移して 4 セクションが揃う', async ({ page }) => {
        await page.goto('/');
        const sidebar = page
            .locator('aside[data-threads-loaded="true"]')
            .first();
        await expect(sidebar).toBeVisible({ timeout: TIMEOUT_MS });

        // サイドバーの「📊 KB不足分析」リンクをクリック
        await sidebar.getByTestId('insights-nav-link').click();

        // loaded マーカーで data fetch 完了を待つ
        await expect(
            page.locator('main[data-insights-loaded="true"]'),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        // 4 つのセクションが揃って表示されること
        await expect(page.getByTestId('insights-summary')).toBeVisible();
        await expect(page.getByTestId('insights-monthly')).toBeVisible();
        await expect(page.getByTestId('insights-histogram')).toBeVisible();
        await expect(page.getByTestId('insights-table')).toBeVisible();

        // タイトル
        await expect(
            page.getByRole('heading', { name: /KB不足領域分析/ }),
        ).toBeVisible();

        // CSV ボタンの存在 (未解決質問が 0 件ならは disabled だが、要素自体は出ている)
        await expect(page.getByTestId('insights-csv-button')).toBeVisible();
    });

    test('「← 会話に戻る」リンクで / に戻れる', async ({ page }) => {
        await page.goto('/insights');
        await expect(
            page.locator('main[data-insights-loaded="true"]'),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        await page.getByRole('link', { name: /会話に戻る/ }).click();

        // 戻った先の / でサイドバーが見える
        const sidebar = page
            .locator('aside[data-threads-loaded="true"]')
            .first();
        await expect(sidebar).toBeVisible({ timeout: TIMEOUT_MS });
    });
});
