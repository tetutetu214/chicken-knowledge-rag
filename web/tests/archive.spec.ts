import { expect, test } from '@playwright/test';

// アーカイブ (ゴミ箱モデル) の E2E。
// Bedrock を呼ばずに「+新しい会話」だけで Conversation を生成し、
// 1 シナリオ内で 作成 → ゴミ箱送り → 復元 → 完全削除 を完結する。
//
// このテストは、Amplify Data v2 の `a.boolean()` フィールドが自動 selection set から
// 脱落する事故 (2026-05-16 本番障害) を再発させない見張り役を担う。
//
// 注意: sandbox を家族の本番として共有しているため、テスト中に作ったスレッドは
// 必ずテスト終了までに「完全削除」して残骸を残さない設計にしている。

const TIMEOUT_MS = 15_000;

test.describe('スレッドのアーカイブ/復元/完全削除', () => {
    test('フルサイクル: 新規作成 → ゴミ箱送り → 復元 → 完全削除', async ({
        page,
    }) => {
        // 確認ダイアログ (ゴミ箱送り・完全削除) は自動承認する。
        page.on('dialog', (dialog) => dialog.accept());

        await page.goto('/');

        // loadThreads 完了マーカー (page.tsx の data-threads-loaded="true") を待つ。
        // 件数表示や networkidle は loadThreads の useState 反映を確実に拾えないため、
        // 専用マーカーで「アクティブ/ゴミ箱の描画が確定した」状態を保証する。
        const sidebar = page.locator('aside[data-threads-loaded="true"]').first();
        await expect(sidebar).toBeVisible({ timeout: TIMEOUT_MS });

        const baseActive = await sidebar
            .getByRole('button', { name: 'ゴミ箱へ移動' })
            .count();
        const baseArchived = await sidebar
            .getByRole('button', { name: '今すぐ削除' })
            .count();

        // ─── STEP 1: 新規作成 → アクティブ +1 ─────────────────────────
        await sidebar
            .getByRole('button', { name: /\+ 新しい会話/ })
            .click();
        await expect
            .poll(
                () =>
                    sidebar
                        .getByRole('button', { name: 'ゴミ箱へ移動' })
                        .count(),
                { timeout: TIMEOUT_MS },
            )
            .toBe(baseActive + 1);

        // ─── STEP 2: ゴミ箱送り → アクティブ -1, ゴミ箱 +1 ───────────
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
            .toBe(baseActive);
        await expect
            .poll(
                () =>
                    sidebar
                        .getByRole('button', { name: '今すぐ削除' })
                        .count(),
                { timeout: TIMEOUT_MS },
            )
            .toBe(baseArchived + 1);

        // ─── STEP 3: ゴミ箱から復元 → アクティブ +1 戻る ──────────────
        await sidebar
            .getByRole('button', { name: '復元' })
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
            .toBe(baseActive + 1);

        // ─── STEP 4: 後片付け (再ゴミ箱送り + 完全削除) ──────────────
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
                { timeout: TIMEOUT_MS },
            )
            .toBe(baseArchived + 1);
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
            .toBe(baseArchived);
        // 最終的に開始時と完全に同数に戻る (差分 0)
        expect(
            await sidebar
                .getByRole('button', { name: 'ゴミ箱へ移動' })
                .count(),
        ).toBe(baseActive);
    });
});
