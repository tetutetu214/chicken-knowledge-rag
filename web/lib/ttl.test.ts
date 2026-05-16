import { describe, expect, it } from 'vitest';
import {
    ARCHIVE_TTL_DAYS,
    archiveExpiresAt,
    remainingDaysUntilDelete,
} from './ttl';

describe('archiveExpiresAt', () => {
    it('90 日後の Unix epoch 秒を返す (ミリ秒ではない)', () => {
        const now = new Date('2026-05-16T00:00:00Z').getTime();
        const expected = Math.floor(now / 1000) + 90 * 86400;
        expect(archiveExpiresAt(now)).toBe(expected);
    });

    it('秒精度 (整数) で返す — ミリ秒を引きずらない', () => {
        const now = 1747353599999; // 末尾 999ms
        const value = archiveExpiresAt(now);
        expect(Number.isInteger(value)).toBe(true);
    });

    it('ARCHIVE_TTL_DAYS は 90 (TTL 仕様の根拠定数)', () => {
        expect(ARCHIVE_TTL_DAYS).toBe(90);
    });
});

describe('remainingDaysUntilDelete', () => {
    const now = new Date('2026-05-16T00:00:00Z').getTime();

    it('null を渡したら null を返す (アクティブ会話 = TTL対象外)', () => {
        expect(remainingDaysUntilDelete(null, now)).toBeNull();
    });

    it('未来の expiresAt は残日数 (切り上げ) を返す', () => {
        const expiresAt = Math.floor(now / 1000) + 45 * 86400;
        expect(remainingDaysUntilDelete(expiresAt, now)).toBe(45);
    });

    it('1 日未満の端数は切り上げで 1 日扱い', () => {
        const expiresAt = Math.floor(now / 1000) + 100; // 100 秒後
        expect(remainingDaysUntilDelete(expiresAt, now)).toBe(1);
    });

    it('期限切れ (秒数 <= 0) は 0 を返す (負値で混乱させない)', () => {
        const expiresAt = Math.floor(now / 1000) - 86400;
        expect(remainingDaysUntilDelete(expiresAt, now)).toBe(0);
    });

    it('境界値: 残り 0 秒ちょうどは 0 を返す', () => {
        const expiresAt = Math.floor(now / 1000);
        expect(remainingDaysUntilDelete(expiresAt, now)).toBe(0);
    });
});
