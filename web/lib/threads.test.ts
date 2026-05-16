import { describe, expect, it } from 'vitest';
import {
    filterActive,
    filterArchived,
    findOrphanActiveThreads,
    sortByUpdatedAtDesc,
    type ThreadRow,
    toThreadRow,
} from './threads';

describe('toThreadRow', () => {
    it('基本フィールドをそのままコピーする', () => {
        const row = toThreadRow({
            id: 'a',
            title: 'タイトル',
            summary: '要約',
            summarizedCount: 3,
            archived: true,
            expiresAt: 1000,
            updatedAt: '2026-05-16T00:00:00Z',
        });
        expect(row).toEqual({
            id: 'a',
            title: 'タイトル',
            summary: '要約',
            summarizedCount: 3,
            archived: true,
            expiresAt: 1000,
            updatedAt: '2026-05-16T00:00:00Z',
        });
    });

    it('archived が true 以外 (false/null/undefined) はすべて false に丸める', () => {
        const base = {
            id: 'a',
            title: 't',
            updatedAt: '2026-05-16T00:00:00Z',
        };
        expect(toThreadRow({ ...base, archived: false }).archived).toBe(false);
        expect(toThreadRow({ ...base, archived: null }).archived).toBe(false);
        expect(toThreadRow({ ...base, archived: undefined }).archived).toBe(
            false,
        );
        expect(toThreadRow(base).archived).toBe(false);
    });

    it('archived === true のときだけ archived 扱い', () => {
        const row = toThreadRow({
            id: 'a',
            title: 't',
            archived: true,
            updatedAt: '2026-05-16T00:00:00Z',
        });
        expect(row.archived).toBe(true);
    });

    it('summary / summarizedCount / expiresAt が未指定なら既定値を入れる', () => {
        const row = toThreadRow({
            id: 'a',
            title: 't',
            updatedAt: '2026-05-16T00:00:00Z',
        });
        expect(row.summary).toBe('');
        expect(row.summarizedCount).toBe(0);
        expect(row.expiresAt).toBeNull();
    });
});

const mkRow = (
    overrides: Partial<ThreadRow> & Pick<ThreadRow, 'id'>,
): ThreadRow => ({
    title: '',
    summary: '',
    summarizedCount: 0,
    archived: false,
    expiresAt: null,
    updatedAt: '2026-05-16T00:00:00Z',
    ...overrides,
});

describe('sortByUpdatedAtDesc', () => {
    it('updatedAt の降順に並べる (新しい順)', () => {
        const sorted = sortByUpdatedAtDesc([
            mkRow({ id: 'a', updatedAt: '2026-05-01T00:00:00Z' }),
            mkRow({ id: 'b', updatedAt: '2026-05-16T00:00:00Z' }),
            mkRow({ id: 'c', updatedAt: '2026-05-10T00:00:00Z' }),
        ]);
        expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    });

    it('元配列を破壊しない (immutable)', () => {
        const input = [
            mkRow({ id: 'a', updatedAt: '2026-05-01T00:00:00Z' }),
            mkRow({ id: 'b', updatedAt: '2026-05-16T00:00:00Z' }),
        ];
        const before = input.map((r) => r.id);
        sortByUpdatedAtDesc(input);
        expect(input.map((r) => r.id)).toEqual(before);
    });
});

describe('filterActive / filterArchived', () => {
    const rows = [
        mkRow({ id: 'active1', archived: false }),
        mkRow({ id: 'archived1', archived: true }),
        mkRow({ id: 'active2', archived: false }),
        mkRow({ id: 'archived2', archived: true }),
    ];

    it('filterActive はアクティブ (archived=false) のみ返す', () => {
        expect(filterActive(rows).map((r) => r.id)).toEqual([
            'active1',
            'active2',
        ]);
    });

    it('filterArchived はゴミ箱 (archived=true) のみ返す', () => {
        expect(filterArchived(rows).map((r) => r.id)).toEqual([
            'archived1',
            'archived2',
        ]);
    });
});

describe('findOrphanActiveThreads', () => {
    it('アクティブで expiresAt が設定されているレコードを検出 (旧仕様救済)', () => {
        const rows = [
            mkRow({ id: 'orphan', archived: false, expiresAt: 12345 }),
            mkRow({ id: 'fine-active', archived: false, expiresAt: null }),
            mkRow({ id: 'fine-archived', archived: true, expiresAt: 12345 }),
        ];
        expect(findOrphanActiveThreads(rows).map((r) => r.id)).toEqual([
            'orphan',
        ]);
    });

    it('該当レコードがなければ空配列', () => {
        const rows = [
            mkRow({ id: 'a', archived: false, expiresAt: null }),
            mkRow({ id: 'b', archived: true, expiresAt: 100 }),
        ];
        expect(findOrphanActiveThreads(rows)).toEqual([]);
    });
});
