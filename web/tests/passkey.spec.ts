import { expect, test } from '@playwright/test';

const TIMEOUT_MS = 15_000;

test.describe('パスキー管理モーダル', () => {
    test('サイドバーから開いて閉じられる', async ({ page }) => {
        await page.goto('/');

        const sidebar = page
            .locator('aside[data-threads-loaded="true"]')
            .first();
        await expect(sidebar).toBeVisible({ timeout: TIMEOUT_MS });

        await sidebar
            .getByRole('button', { name: '🔑 パスキー管理' })
            .click();

        const dialog = page.getByRole('dialog', { name: 'パスキー管理' });
        await expect(dialog).toBeVisible({ timeout: TIMEOUT_MS });
        await expect(
            dialog.getByRole('button', { name: 'パスキーを登録' }),
        ).toBeVisible();

        await dialog
            .getByRole('button', { name: 'パスキー管理を閉じる' })
            .click();
        await expect(dialog).toBeHidden();
    });
});
