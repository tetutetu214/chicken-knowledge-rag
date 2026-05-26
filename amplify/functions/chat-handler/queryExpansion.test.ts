/**
 * queryExpansion.ts の単体テスト (Issue #31 派生スコープ)。
 *
 * モック方針:
 * Bedrock API (Converse / Retrieve) を**本物で叩くと AWS 認証 + 課金が発生**し、
 * CI でも回せなくなる。そのため AWS SDK Client (`send()`) はモック化する。
 * モック対象は reformulateQuery / expandIfNeeded のみで、純関数 (computeTopScore /
 * shouldExpand / mergeRetrievalResults) はモックなしでテストする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
    BedrockAgentRuntimeClient,
    type KnowledgeBaseRetrievalResult,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
    computeTopScore,
    shouldExpand,
    reformulateQuery,
    mergeRetrievalResults,
    expandIfNeeded,
    type QueryExpansionConfig,
} from './queryExpansion';

const baseConfig: QueryExpansionConfig = {
    enabled: true,
    lowerThreshold: 0.62,
    upperThreshold: 0.7,
    maxReformulations: 2,
    modelId: 'apac.amazon.nova-pro-v1:0',
};

const makeResult = (
    score: number,
    uri: string = 's3://bucket/doc.pdf',
    page: number = 1,
): KnowledgeBaseRetrievalResult => ({
    content: { text: 'chunk text' },
    location: {
        type: 'S3',
        s3Location: { uri },
    },
    score,
    metadata: {
        'x-amz-bedrock-kb-document-page-number': page,
    },
});

describe('computeTopScore', () => {
    it('空配列なら 0 を返す', () => {
        expect(computeTopScore([])).toBe(0);
    });

    it('複数結果の中から最高 score を返す', () => {
        const results = [makeResult(0.5), makeResult(0.8), makeResult(0.65)];
        expect(computeTopScore(results)).toBe(0.8);
    });

    it('score が undefined の項目は 0 として扱い、他の項目で集計する', () => {
        const noScore = { content: { text: 'x' } } as KnowledgeBaseRetrievalResult;
        const results = [noScore, makeResult(0.5)];
        expect(computeTopScore(results)).toBe(0.5);
    });
});

describe('shouldExpand', () => {
    it('enabled=false なら拡張帯内でも false を返す (運用フラグで完全バイパス可)', () => {
        expect(shouldExpand(0.65, { ...baseConfig, enabled: false })).toBe(false);
    });

    it('maxReformulations=0 なら閾値関係なく false を返す', () => {
        expect(shouldExpand(0.65, { ...baseConfig, maxReformulations: 0 })).toBe(false);
    });

    it('topScore が lowerThreshold ジャストなら true (拡張帯下端を含む)', () => {
        expect(shouldExpand(0.62, baseConfig)).toBe(true);
    });

    it('topScore が upperThreshold ジャストなら false (KB ヒット明確帯に振り分ける)', () => {
        expect(shouldExpand(0.7, baseConfig)).toBe(false);
    });

    it('topScore が拡張帯内 (lower 以上 upper 未満) なら true', () => {
        expect(shouldExpand(0.65, baseConfig)).toBe(true);
    });

    it('topScore が lowerThreshold 未満なら false (KB に無い質問はバイパス)', () => {
        expect(shouldExpand(0.61, baseConfig)).toBe(false);
    });
});

describe('mergeRetrievalResults', () => {
    it('同じ URI + page の結果を 1 件に統合し、score が高い方を残す', () => {
        const a = [makeResult(0.5, 's3://x/a.pdf', 1)];
        const b = [makeResult(0.8, 's3://x/a.pdf', 1)];
        const merged = mergeRetrievalResults(a, b);
        expect(merged).toHaveLength(1);
        expect(merged[0].score).toBe(0.8);
    });

    it('異なる URI + page は別件として残す', () => {
        const a = [makeResult(0.5, 's3://x/a.pdf', 1)];
        const b = [makeResult(0.8, 's3://x/b.pdf', 2)];
        const merged = mergeRetrievalResults(a, b);
        expect(merged).toHaveLength(2);
    });

    it('score 降順でソートされる', () => {
        const a = [makeResult(0.5, 's3://x/a.pdf', 1)];
        const b = [makeResult(0.9, 's3://x/b.pdf', 1)];
        const c = [makeResult(0.7, 's3://x/c.pdf', 1)];
        const merged = mergeRetrievalResults(a, b, c);
        expect(merged.map((r) => r.score)).toEqual([0.9, 0.7, 0.5]);
    });

    it('空配列を渡しても落ちず、空配列を返す', () => {
        expect(mergeRetrievalResults()).toEqual([]);
        expect(mergeRetrievalResults([], [])).toEqual([]);
    });

    it('3 つ以上の配列を結合できる (元 + リフォーム 2 個のマージを想定)', () => {
        const a = [makeResult(0.5, 's3://x/a.pdf', 1)];
        const b = [makeResult(0.6, 's3://x/b.pdf', 1)];
        const c = [makeResult(0.7, 's3://x/c.pdf', 1)];
        const merged = mergeRetrievalResults(a, b, c);
        expect(merged).toHaveLength(3);
    });
});

describe('reformulateQuery', () => {
    let mockRuntimeClient: BedrockRuntimeClient;
    let sendMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        sendMock = vi.fn();
        mockRuntimeClient = {
            send: sendMock,
        } as unknown as BedrockRuntimeClient;
    });

    it('Nova Pro 出力を改行で分割してリフォーム文配列を返す', async () => {
        sendMock.mockResolvedValueOnce({
            output: {
                message: {
                    content: [
                        { text: '鶏の頚椎は何本ですか?\nニワトリの首の骨格構造を教えて' },
                    ],
                },
            },
        });
        const result = await reformulateQuery(
            '鶏の首の骨は何本?',
            mockRuntimeClient,
            baseConfig,
        );
        expect(result).toEqual([
            '鶏の頚椎は何本ですか?',
            'ニワトリの首の骨格構造を教えて',
        ]);
    });

    it('Nova Pro が空文字を返したら空配列で fallback', async () => {
        sendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: '' }] } },
        });
        const result = await reformulateQuery('質問', mockRuntimeClient, baseConfig);
        expect(result).toEqual([]);
    });

    it('Nova Pro 呼出が例外を投げたら空配列で fallback (handler を落とさない)', async () => {
        sendMock.mockRejectedValueOnce(new Error('ThrottlingException'));
        const result = await reformulateQuery('質問', mockRuntimeClient, baseConfig);
        expect(result).toEqual([]);
    });

    it('maxReformulations 超過分は切り捨て', async () => {
        sendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: 'A\nB\nC\nD' }] } },
        });
        const result = await reformulateQuery('Q', mockRuntimeClient, {
            ...baseConfig,
            maxReformulations: 2,
        });
        expect(result).toEqual(['A', 'B']);
    });

    it('元の質問と完全一致するリフォーム文は除外する (拡張効果ゼロを避ける)', async () => {
        sendMock.mockResolvedValueOnce({
            output: {
                message: { content: [{ text: '元の質問\n別表現の質問' }] },
            },
        });
        const result = await reformulateQuery(
            '元の質問',
            mockRuntimeClient,
            baseConfig,
        );
        expect(result).toEqual(['別表現の質問']);
    });

    it('リフォーム文同士の重複も除外する', async () => {
        sendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: 'A\nA\nB' }] } },
        });
        const result = await reformulateQuery('Q', mockRuntimeClient, baseConfig);
        expect(result).toEqual(['A', 'B']);
    });

    it('先頭の番号付け (「1. 」「- 」「・」) は除去する (LLM が指示無視で付けるケースの fallback)', async () => {
        sendMock.mockResolvedValueOnce({
            output: {
                message: {
                    content: [{ text: '1. 鶏の頚椎\n- ニワトリの首\n・首の骨格' }],
                },
            },
        });
        const result = await reformulateQuery('Q', mockRuntimeClient, {
            ...baseConfig,
            maxReformulations: 3,
        });
        expect(result).toEqual(['鶏の頚椎', 'ニワトリの首', '首の骨格']);
    });

    it('質問が空文字なら API を呼ばずに空配列を返す (無駄なコストを避ける)', async () => {
        const result = await reformulateQuery('   ', mockRuntimeClient, baseConfig);
        expect(result).toEqual([]);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('enabled=false なら API を呼ばずに空配列を返す', async () => {
        const result = await reformulateQuery('Q', mockRuntimeClient, {
            ...baseConfig,
            enabled: false,
        });
        expect(result).toEqual([]);
        expect(sendMock).not.toHaveBeenCalled();
    });
});

describe('expandIfNeeded', () => {
    let mockRuntimeClient: BedrockRuntimeClient;
    let mockAgentClient: BedrockAgentRuntimeClient;
    let runtimeSendMock: ReturnType<typeof vi.fn>;
    let agentSendMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        runtimeSendMock = vi.fn();
        agentSendMock = vi.fn();
        mockRuntimeClient = {
            send: runtimeSendMock,
        } as unknown as BedrockRuntimeClient;
        mockAgentClient = {
            send: agentSendMock,
        } as unknown as BedrockAgentRuntimeClient;
    });

    it('enabled=false なら拡張処理を一切走らせず元結果をそのまま返す (既存挙動の完全保証)', async () => {
        const original = [makeResult(0.65)];
        const result = await expandIfNeeded(
            '質問',
            original,
            { ...baseConfig, enabled: false },
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.results).toBe(original);
        expect(result.topScore).toBe(0.65);
        expect(result.expansionAttempted).toBe(false);
        expect(runtimeSendMock).not.toHaveBeenCalled();
        expect(agentSendMock).not.toHaveBeenCalled();
    });

    it('topScore が upperThreshold 以上ならバイパス (KB ヒット明確なので拡張不要)', async () => {
        const original = [makeResult(0.8)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionAttempted).toBe(false);
        expect(result.results).toBe(original);
    });

    it('topScore が lowerThreshold 未満ならバイパス (KB に無いので拡張しても無駄)', async () => {
        const original = [makeResult(0.5)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionAttempted).toBe(false);
        expect(result.results).toBe(original);
    });

    it('リフォーム後 topScore が upperThreshold 以上なら救済成功、merged 結果を返す', async () => {
        runtimeSendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: '言い換え1\n言い換え2' }] } },
        });
        agentSendMock.mockResolvedValueOnce({
            retrievalResults: [makeResult(0.85, 's3://x/rescue.pdf', 5)],
        });
        agentSendMock.mockResolvedValueOnce({
            retrievalResults: [makeResult(0.78, 's3://x/rescue2.pdf', 3)],
        });
        const original = [makeResult(0.65)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionAttempted).toBe(true);
        expect(result.expansionRescued).toBe(true);
        expect(result.topScore).toBe(0.85);
        expect(result.reformulations).toEqual(['言い換え1', '言い換え2']);
    });

    it('リフォーム後も topScore が低いままなら救済失敗、元結果を返す (KB ヒットなし扱いに進む)', async () => {
        runtimeSendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: '言い換え1' }] } },
        });
        agentSendMock.mockResolvedValueOnce({
            retrievalResults: [makeResult(0.66, 's3://x/y.pdf', 1)],
        });
        const original = [makeResult(0.65, 's3://x/z.pdf', 1)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionAttempted).toBe(true);
        expect(result.expansionRescued).toBe(false);
        expect(result.results).toBe(original);
        expect(result.topScore).toBe(0.65);
    });

    it('Nova Pro 呼出失敗時は元結果を返し、追加 Retrieve も呼ばない (handler を落とさない)', async () => {
        runtimeSendMock.mockRejectedValueOnce(new Error('Bedrock down'));
        const original = [makeResult(0.65)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionAttempted).toBe(true);
        expect(result.expansionRescued).toBe(false);
        expect(result.results).toBe(original);
        expect(agentSendMock).not.toHaveBeenCalled();
    });

    it('リフォーム文が 0 件ならバイパス (Nova Pro が空応答を返したケース)', async () => {
        runtimeSendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: '' }] } },
        });
        const original = [makeResult(0.65)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionRescued).toBe(false);
        expect(result.results).toBe(original);
        expect(agentSendMock).not.toHaveBeenCalled();
    });

    it('リフォーム Retrieve が一部失敗しても、成功した結果でマージを試みる', async () => {
        runtimeSendMock.mockResolvedValueOnce({
            output: { message: { content: [{ text: '言い換え1\n言い換え2' }] } },
        });
        agentSendMock
            .mockResolvedValueOnce({
                retrievalResults: [makeResult(0.88, 's3://x/rescue.pdf', 1)],
            })
            .mockRejectedValueOnce(new Error('partial failure'));
        const original = [makeResult(0.65)];
        const result = await expandIfNeeded(
            '質問',
            original,
            baseConfig,
            mockRuntimeClient,
            mockAgentClient,
            'kb-id',
        );
        expect(result.expansionRescued).toBe(true);
        expect(result.topScore).toBe(0.88);
    });
});
