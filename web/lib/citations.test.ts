import { describe, expect, it } from 'vitest';
import { parseCitations } from './citations';

describe('parseCitations', () => {
    it('null / undefined / 空文字は空配列を返す', () => {
        expect(parseCitations(null)).toEqual([]);
        expect(parseCitations(undefined)).toEqual([]);
        expect(parseCitations('')).toEqual([]);
    });

    it('JSON 文字列をパースして Citation 配列に変換できる', () => {
        const raw = JSON.stringify([
            { uri: 's3://docs/a.pdf', page: 3 },
            { uri: 's3://docs/b.pdf', page: null },
        ]);
        expect(parseCitations(raw)).toEqual([
            { uri: 's3://docs/a.pdf', page: 3 },
            { uri: 's3://docs/b.pdf', page: null },
        ]);
    });

    it('JSON.parse 済みのオブジェクト配列もそのまま処理できる', () => {
        const raw = [{ uri: 's3://docs/a.pdf', page: 7 }];
        expect(parseCitations(raw)).toEqual([
            { uri: 's3://docs/a.pdf', page: 7 },
        ]);
    });

    it('壊れた JSON 文字列は空配列を返す (例外を投げない)', () => {
        expect(parseCitations('{not valid json')).toEqual([]);
    });

    it('uri が文字列でないオブジェクトは uri="" に正規化される', () => {
        expect(parseCitations([{ uri: 123, page: 1 }])).toEqual([
            { uri: '', page: 1 },
        ]);
    });

    it('page が数値でない場合は null に正規化される', () => {
        expect(parseCitations([{ uri: 's3://x.pdf', page: '3' }])).toEqual([
            { uri: 's3://x.pdf', page: null },
        ]);
    });

    it('配列でないオブジェクトは空配列を返す', () => {
        expect(parseCitations({ uri: 'x', page: 1 })).toEqual([]);
    });

    it('要素が null の配列も安全にスキップして空 Citation に変換される', () => {
        expect(parseCitations([null])).toEqual([{ uri: '', page: null }]);
    });
});
