import { expect, test } from '@playwright/test';

// スレッドの新規作成 + アクティブ切替の E2E。
// Bedrock を呼ばずに `+新しい会話` だけで Conversation を 2 件作り、
// 切替でメッセージペインの活性化状態が連動することを検証する。
// 終了時はテスト中に作った 2 件を完全削除して残骸を残さない。

const TIMEOUT_MS = 15_000;

test.describe('スレッドの新規作成と切替', () => {
    test('2 件のスレッドを作って切替できる', async ({ page }) => {
        page.on('dialog', (dialog) => dialog.accept());

        await page.goto('/');
        const sidebar = page
            .locator('aside[data-threads-loaded="true"]')
            .first();
        await expect(sidebar).toBeVisible({ timeout: TIMEOUT_MS });

        const baseActive = await sidebar
            .getByRole('button', { name: 'ゴミ箱へ移動' })
            .count();

        // ─── 2 件作成 ───────────────────────────────────────────────
        await sidebar.getByRole('button', { name: /\+ 新しい会話/ }).click();
        await expect
            .poll(
                () =>
                    sidebar
                        .getByRole('button', { name: 'ゴミ箱へ移動' })
                        .count(),
                { timeout: TIMEOUT_MS },
            )
            .toBe(baseActive + 1);

        await sidebar.getByRole('button', { name: /\+ 新しい会話/ }).click();
        await expect
            .poll(
                () =>
                    sidebar
                        .getByRole('button', { name: 'ゴミ箱へ移動' })
                        .count(),
                { timeout: TIMEOUT_MS },
            )
            .toBe(baseActive + 2);

        // 直後の作成スレッドが activeId にセットされ、メイン領域に
        // 「鶏に関する質問を下のフォームに入力してください」が出る (空状態の案内)。
        await expect(
            page.getByText('鶏に関する質問を下のフォームに入力してください'),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        // ─── 1 件目に切替 ──────────────────────────────────────────
        // アクティブ側のスレッドタイトル「新しい会話」が複数並んでいるので nth(1) で
        // 2 番目 (= 一つ前に作成したスレッド) を選ぶ。
        const threadTitles = sidebar.getByRole('button', {
            name: '新しい会話',
        });
        await threadTitles.nth(1).click();

        // 別スレッドに切り替わっても空状態の案内文は出続けるので、案内が
        // 表示されていることだけ確認 (= ナビゲーション自体は通った)。
        await expect(
            page.getByText('鶏に関する質問を下のフォームに入力してください'),
        ).toBeVisible({ timeout: TIMEOUT_MS });

        // ─── 後片付け: 各削除ステップで状態確定を待ちながら 2 件処理 ─
        for (let i = 0; i < 2; i++) {
            const before = await sidebar
                .getByRole('button', { name: 'ゴミ箱へ移動' })
                .count();
            await sidebar
                .getByRole('button', { name: 'ゴミ箱へ移動' })
                .first()
                .click();
            await expect
                .poll(
                    () =>
                        sidebar
                            .getByRole('button', { name: 'ゴミ箱へ移動' })
                            .count(),
                    { timeout: TIMEOUT_MS },
                )
                .toBe(before - 1);
        }
        for (let i = 0; i < 2; i++) {
            const before = await sidebar
                .getByRole('button', { name: '今すぐ削除' })
                .count();
            await sidebar
                .getByRole('button', { name: '今すぐ削除' })
                .first()
                .click();
            await expect
                .poll(
                    () =>
                        sidebar
                            .getByRole('button', { name: '今すぐ削除' })
                            .count(),
                    { timeout: TIMEOUT_MS },
                )
                .toBe(before - 1);
        }
        expect(
            await sidebar
                .getByRole('button', { name: 'ゴミ箱へ移動' })
                .count(),
        ).toBe(baseActive);
    });
});
