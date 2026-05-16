import { devices, expect, test } from '@playwright/test';

// スマホビューポートでの UI 挙動。
// - md (768px) 未満ではサイドバーがハンバーガー化し、初期状態で隠れている
// - ☰ ボタンタップで開く、背景オーバーレイタップで閉じる
// PC 幅 (chromium-authed の Desktop Chrome) ではこの挙動は無効化されるため、
// このファイルだけ Pixel 5 デバイスエミュレーションを上書きする。

test.use({ ...devices['Pixel 5'] });

const TIMEOUT_MS = 15_000;

test.describe('スマホ表示 (md 未満) のサイドバー開閉', () => {
    test('初期はサイドバーが画面外、☰ で開いてオーバーレイで閉じる', async ({
        page,
    }) => {
        await page.goto('/');

        // loadThreads 完了を待つ (data-threads-loaded マーカー)
        const sidebar = page
            .locator('aside[data-threads-loaded="true"]')
            .first();
        await expect(sidebar).toBeAttached({ timeout: TIMEOUT_MS });

        // ハンバーガーボタンが表示されている (md 未満)
        const hamburger = page.getByRole('button', {
            name: 'メニューを開く',
        });
        await expect(hamburger).toBeVisible();

        // 初期状態: サイドバーは -translate-x-full でビューポート外
        // (DOM 上は存在するが、X 座標が負側にあるはず)
        const sidebarBox = await sidebar.boundingBox();
        expect(sidebarBox).not.toBeNull();
        if (sidebarBox) {
            expect(sidebarBox.x).toBeLessThan(0);
        }

        // ☰ をタップ → サイドバーが画面内に入る
        await hamburger.click();
        await expect
            .poll(async () => {
                const box = await sidebar.boundingBox();
                return box ? box.x : -9999;
            }, { timeout: TIMEOUT_MS })
            .toBeGreaterThanOrEqual(0);

        // 背景オーバーレイ (md:hidden fixed inset-0 z-30 bg-black/50) が表示される
        const overlay = page.locator('div.bg-black\\/50').first();
        await expect(overlay).toBeVisible();

        // オーバーレイをタップ → サイドバーが閉じる。Pixel 5 (393x851) で
        // サイドバー幅は 288px のため、画面右端付近 (350,200) を指定して
        // サイドバーに pointer event を奪われないようにする。
        await overlay.click({ position: { x: 350, y: 200 } });
        await expect
            .poll(async () => {
                const box = await sidebar.boundingBox();
                return box ? box.x : 0;
            }, { timeout: TIMEOUT_MS })
            .toBeLessThan(0);
    });
});
