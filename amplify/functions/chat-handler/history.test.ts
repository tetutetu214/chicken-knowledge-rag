import { describe, expect, it } from 'vitest';
import { parseHistory, sanitizeHistory } from './history';

describe('parseHistory', () => {
    it('null / undefined / 空文字は空配列を返す', () => {
        expect(parseHistory(null)).toEqual([]);
        expect(parseHistory(undefined)).toEqual([]);
        expect(parseHistory('')).toEqual([]);
    });

    it('JSON 文字列をパースして RawMessage 配列に変換できる', () => {
        const raw = JSON.stringify([
            { role: 'user', content: 'こんにちは' },
            { role: 'assistant', content: 'コケ' },
        ]);
        expect(parseHistory(raw)).toEqual([
            { role: 'user', content: 'こんにちは' },
            { role: 'assistant', content: 'コケ' },
        ]);
    });

    it('不正な JSON は空配列を返す (例外を投げない)', () => {
        expect(parseHistory('not valid json')).toEqual([]);
    });

    it('配列ではない JSON も空配列を返す', () => {
        expect(parseHistory('{"role":"user","content":"x"}')).toEqual([]);
    });

    it('role が文字列でない要素は user にフォールバックする', () => {
        const raw = JSON.stringify([{ role: 123, content: 'x' }]);
        expect(parseHistory(raw)).toEqual([{ role: 'user', content: 'x' }]);
    });

    it('content が文字列でない要素は空文字にフォールバックする', () => {
        const raw = JSON.stringify([{ role: 'user', content: 42 }]);
        expect(parseHistory(raw)).toEqual([
            { role: 'user', content: '' },
        ]);
    });

    it('null 要素を含む配列も安全に扱う', () => {
        const raw = JSON.stringify([null, { role: 'user', content: 'x' }]);
        expect(parseHistory(raw)).toEqual([
            { role: 'user', content: '' },
            { role: 'user', content: 'x' },
        ]);
    });
});

describe('sanitizeHistory', () => {
    it('Bedrock Converse 仕様 (user 始まり / user 末尾ではない) に整える', () => {
        const result = sanitizeHistory([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
            { role: 'assistant', content: 'a2' },
            { role: 'user', content: 'q3' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
            { role: 'assistant', content: 'a2' },
        ]);
    });

    it('先頭が assistant のときは assistant を捨てる (user 始まりに揃える)', () => {
        const result = sanitizeHistory([
            { role: 'assistant', content: '前回の続き' },
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
    });

    it('連続 assistant も先頭からまとめて捨てる', () => {
        const result = sanitizeHistory([
            { role: 'assistant', content: 'a0' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a2' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a2' },
        ]);
    });

    it('末尾の user は捨てる (この後に新質問の user を追加するため)', () => {
        const result = sanitizeHistory([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2_pending' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
    });

    it('role が user/assistant 以外のメッセージは除外する (system 等)', () => {
        const result = sanitizeHistory([
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
    });

    it('空文字 content (スペースのみ含む) を除外する', () => {
        const result = sanitizeHistory([
            { role: 'user', content: '' },
            { role: 'user', content: '   ' },
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
        expect(result).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
        ]);
    });

    it('全件除外されるケースは空配列を返す (新質問だけ送る扱い)', () => {
        const result = sanitizeHistory([
            { role: 'user', content: 'q1' },
        ]);
        expect(result).toEqual([]);
    });

    it('空入力は空出力', () => {
        expect(sanitizeHistory([])).toEqual([]);
    });
});
