// 引用元 (Citation) の型と、AppSync `a.json()` フィールドから取り出すパース関数。
// Amplify Data は JSON.parse 済みオブジェクトを返すことが多いが、保存形態によっては
// 文字列で返ることもあるため string / object 両対応にしている。

export interface Citation {
    uri: string;
    page: number | null;
}

export const parseCitations = (raw: unknown): Citation[] => {
    if (!raw) return [];
    let value: unknown = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value.map((c: unknown) => {
        const obj = (c ?? {}) as Record<string, unknown>;
        return {
            uri: typeof obj.uri === 'string' ? obj.uri : '',
            page: typeof obj.page === 'number' ? obj.page : null,
        };
    });
};
