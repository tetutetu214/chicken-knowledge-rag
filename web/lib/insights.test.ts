import { describe, expect, it } from 'vitest';
import {
    type InsightsMessage,
    monthlyBuckets,
    pairUserAssistant,
    summarize,
    toCsv,
    topScoreHistogram,
} from './insights';

// テストデータ生成ヘルパ
function msg(
    over: Partial<InsightsMessage> & Pick<InsightsMessage, 'id' | 'role'>,
): InsightsMessage {
    return {
        conversationId: 'c1',
        content: 'dummy',
        hasKbResults: null,
        topScore: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        ...over,
    };
}

describe('pairUserAssistant', () => {
    it('hasKbResults=false の assistant と直前の user を組にする', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'u1', role: 'user', content: 'Q1', createdAt: '2026-05-01T00:00:00Z' }),
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: false,
                topScore: 0.55,
                createdAt: '2026-05-01T00:00:05Z',
            }),
        ];
        const result = pairUserAssistant(messages);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            userId: 'u1',
            userContent: 'Q1',
            topScore: 0.55,
            conversationId: 'c1',
        });
    });

    it('hasKbResults=true の assistant は除外する', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'u1', role: 'user', createdAt: '2026-05-01T00:00:00Z' }),
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: true,
                topScore: 0.9,
                createdAt: '2026-05-01T00:00:05Z',
            }),
        ];
        expect(pairUserAssistant(messages)).toHaveLength(0);
    });

    it('hasKbResults=null の assistant も除外する (PR #47 以前の NULL データ)', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'u1', role: 'user', createdAt: '2026-05-01T00:00:00Z' }),
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: null,
                topScore: null,
                createdAt: '2026-05-01T00:00:05Z',
            }),
        ];
        expect(pairUserAssistant(messages)).toHaveLength(0);
    });

    it('複数 conversation を横断しても conversation 内で組み立てる', () => {
        const messages: InsightsMessage[] = [
            msg({
                id: 'u1',
                conversationId: 'c1',
                role: 'user',
                content: 'c1の質問',
                createdAt: '2026-05-01T00:00:00Z',
            }),
            msg({
                id: 'u2',
                conversationId: 'c2',
                role: 'user',
                content: 'c2の質問',
                createdAt: '2026-05-02T00:00:00Z',
            }),
            msg({
                id: 'a1',
                conversationId: 'c1',
                role: 'assistant',
                hasKbResults: false,
                createdAt: '2026-05-01T00:00:05Z',
            }),
            msg({
                id: 'a2',
                conversationId: 'c2',
                role: 'assistant',
                hasKbResults: false,
                createdAt: '2026-05-02T00:00:05Z',
            }),
        ];
        const result = pairUserAssistant(messages);
        expect(result).toHaveLength(2);
        // 結果は新しい順
        expect(result[0].userContent).toBe('c2の質問');
        expect(result[1].userContent).toBe('c1の質問');
    });

    it('assistant より前に user がない場合は除外する (エッジケース)', () => {
        const messages: InsightsMessage[] = [
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: false,
                createdAt: '2026-05-01T00:00:05Z',
            }),
        ];
        expect(pairUserAssistant(messages)).toHaveLength(0);
    });

    it('結果は userCreatedAt の降順 (新しい質問が上)', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'u1', role: 'user', createdAt: '2026-05-01T00:00:00Z' }),
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: false,
                createdAt: '2026-05-01T00:00:05Z',
            }),
            msg({
                id: 'u2',
                conversationId: 'c2',
                role: 'user',
                createdAt: '2026-05-15T00:00:00Z',
            }),
            msg({
                id: 'a2',
                conversationId: 'c2',
                role: 'assistant',
                hasKbResults: false,
                createdAt: '2026-05-15T00:00:05Z',
            }),
        ];
        const result = pairUserAssistant(messages);
        expect(result[0].userCreatedAt).toContain('2026-05-15');
        expect(result[1].userCreatedAt).toContain('2026-05-01');
    });
});

describe('monthlyBuckets', () => {
    it('過去 N ヶ月の空バケットを必ず生成する (データなしでも空月でゼロを返す)', () => {
        const now = new Date('2026-05-16T00:00:00Z');
        const buckets = monthlyBuckets([], 3, now);
        expect(buckets).toHaveLength(3);
        expect(buckets.map((b) => b.count)).toEqual([0, 0, 0]);
        // 古い順に並ぶ
        expect(buckets[2].month).toBe('2026-05');
    });

    it('質問の発生月でカウントを積む', () => {
        const now = new Date('2026-05-16T00:00:00Z');
        const buckets = monthlyBuckets(
            [
                {
                    userId: 'u1',
                    userContent: '',
                    userCreatedAt: '2026-05-10T00:00:00Z',
                    assistantId: 'a1',
                    topScore: null,
                    conversationId: 'c1',
                },
                {
                    userId: 'u2',
                    userContent: '',
                    userCreatedAt: '2026-04-20T00:00:00Z',
                    assistantId: 'a2',
                    topScore: null,
                    conversationId: 'c2',
                },
                {
                    userId: 'u3',
                    userContent: '',
                    userCreatedAt: '2026-05-15T00:00:00Z',
                    assistantId: 'a3',
                    topScore: null,
                    conversationId: 'c3',
                },
            ],
            3,
            now,
        );
        const map = new Map(buckets.map((b) => [b.month, b.count]));
        expect(map.get('2026-05')).toBe(2);
        expect(map.get('2026-04')).toBe(1);
        expect(map.get('2026-03')).toBe(0);
    });

    it('範囲外の古い月の質問は無視する', () => {
        const now = new Date('2026-05-16T00:00:00Z');
        const buckets = monthlyBuckets(
            [
                {
                    userId: 'u1',
                    userContent: '',
                    userCreatedAt: '2024-01-01T00:00:00Z',
                    assistantId: 'a1',
                    topScore: null,
                    conversationId: 'c1',
                },
            ],
            3,
            now,
        );
        expect(buckets.every((b) => b.count === 0)).toBe(true);
    });
});

describe('topScoreHistogram', () => {
    it('binSize=0.05 で 20 ビンを生成する', () => {
        const result = topScoreHistogram([], 0.05);
        expect(result).toHaveLength(20);
        expect(result[0]).toMatchObject({ binStart: 0, binEnd: 0.05, label: '0.00-0.05' });
        expect(result[19]).toMatchObject({ binStart: 0.95, binEnd: 1, label: '0.95-1.00' });
    });

    it('topScore を該当ビンに振り分ける', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'a1', role: 'assistant', topScore: 0.55 }),
            msg({ id: 'a2', role: 'assistant', topScore: 0.59 }),
            msg({ id: 'a3', role: 'assistant', topScore: 0.7 }),
            msg({ id: 'a4', role: 'assistant', topScore: 0.832 }),
        ];
        const result = topScoreHistogram(messages, 0.05);
        const bin055 = result.find((b) => b.binStart === 0.55);
        const bin07 = result.find((b) => b.binStart === 0.7);
        const bin08 = result.find((b) => b.binStart === 0.8);
        expect(bin055?.count).toBe(2); // 0.55 と 0.59
        expect(bin07?.count).toBe(1);
        expect(bin08?.count).toBe(1);
    });

    it('topScore=null は除外する', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'a1', role: 'assistant', topScore: null }),
            msg({ id: 'a2', role: 'assistant', topScore: 0.5 }),
        ];
        const result = topScoreHistogram(messages, 0.05);
        const total = result.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(1);
    });

    it('topScore=1.0 ちょうどは最後のビンに含める (右端閉区間)', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'a1', role: 'assistant', topScore: 1.0 }),
        ];
        const result = topScoreHistogram(messages, 0.05);
        expect(result[result.length - 1].count).toBe(1);
    });

    it('範囲外 topScore (< 0 / > 1) は無視する', () => {
        const messages: InsightsMessage[] = [
            msg({ id: 'a1', role: 'assistant', topScore: -0.1 }),
            msg({ id: 'a2', role: 'assistant', topScore: 1.5 }),
        ];
        const result = topScoreHistogram(messages, 0.05);
        expect(result.reduce((s, b) => s + b.count, 0)).toBe(0);
    });
});

describe('summarize', () => {
    it('user 数 / 未解決数 / 直近30日未解決 / 平均topScore を返す', () => {
        const now = new Date('2026-05-16T00:00:00Z');
        const messages: InsightsMessage[] = [
            msg({ id: 'u1', role: 'user', createdAt: '2026-05-10T00:00:00Z' }),
            msg({
                id: 'a1',
                role: 'assistant',
                hasKbResults: false,
                topScore: 0.5,
                createdAt: '2026-05-10T00:00:05Z',
            }),
            msg({ id: 'u2', role: 'user', createdAt: '2026-03-01T00:00:00Z', conversationId: 'c2' }),
            msg({
                id: 'a2',
                conversationId: 'c2',
                role: 'assistant',
                hasKbResults: false,
                topScore: 0.6,
                createdAt: '2026-03-01T00:00:05Z',
            }),
            msg({ id: 'u3', role: 'user', createdAt: '2026-05-15T00:00:00Z', conversationId: 'c3' }),
            msg({
                id: 'a3',
                conversationId: 'c3',
                role: 'assistant',
                hasKbResults: true,
                topScore: 0.9,
                createdAt: '2026-05-15T00:00:05Z',
            }),
        ];
        const s = summarize(messages, now);
        expect(s.totalQuestions).toBe(3);
        expect(s.unresolvedQuestions).toBe(2);
        // 2026-03-01 は 30 日以上前
        expect(s.unresolvedLast30Days).toBe(1);
        expect(s.avgTopScore).toBeCloseTo((0.5 + 0.6 + 0.9) / 3, 5);
    });

    it('topScore がひとつもなければ avgTopScore=null', () => {
        const s = summarize(
            [msg({ id: 'u1', role: 'user' })],
            new Date('2026-05-16T00:00:00Z'),
        );
        expect(s.avgTopScore).toBeNull();
    });
});

describe('toCsv', () => {
    it('ヘッダ行 + データ行を CRLF 区切りで返す', () => {
        const csv = toCsv(
            [
                {
                    userId: 'u1',
                    userContent: '鶏卵の保存方法は?',
                    userCreatedAt: '2026-05-10T00:00:00Z',
                    assistantId: 'a1',
                    topScore: 0.55,
                    conversationId: 'c1',
                },
            ],
            new Map([['c1', '保存についての会話']]),
        );
        const lines = csv.split('\r\n');
        expect(lines[0]).toBe(
            'createdAt,question,topScore,conversationTitle,conversationId',
        );
        expect(lines[1]).toBe(
            '2026-05-10T00:00:00Z,鶏卵の保存方法は?,0.55,保存についての会話,c1',
        );
    });

    it('カンマ・ダブルクォート・改行を含むセルは正しくエスケープする', () => {
        const csv = toCsv(
            [
                {
                    userId: 'u1',
                    userContent: '"鶏卵"の保存,改行\n込み',
                    userCreatedAt: '2026-05-10T00:00:00Z',
                    assistantId: 'a1',
                    topScore: null,
                    conversationId: 'c1',
                },
            ],
            new Map(),
        );
        const dataLine = csv.split('\r\n')[1];
        // ダブルクォートで囲まれ、内部の " は "" にエスケープされる
        expect(dataLine).toContain('"""鶏卵""の保存,改行\n込み"');
        // conversationTitle が Map にない場合は空文字
        expect(dataLine).toContain(',,c1');
    });

    it('topScore=null は空文字で出力する', () => {
        const csv = toCsv(
            [
                {
                    userId: 'u1',
                    userContent: 'q',
                    userCreatedAt: '2026-05-10T00:00:00Z',
                    assistantId: 'a1',
                    topScore: null,
                    conversationId: 'c1',
                },
            ],
            new Map(),
        );
        // ,, が連続 (topScore 列が空)
        expect(csv.split('\r\n')[1]).toMatch(/^2026-05-10T00:00:00Z,q,,,c1$/);
    });
});
