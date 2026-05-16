// 会話履歴の安全なパースと、Bedrock Converse API 仕様 (user/assistant 交互、
// 先頭 user / 末尾 user 以外) に整える整形関数。
// handler.ts から切り出して単体テスト可能にした (Vitest)。

export interface RawMessage {
    role: string;
    content: string;
}

// フロントから渡される historyJson (string) をパースして RawMessage 配列に変換する。
// 不正 JSON や型崩れに対しては silent に空配列で返し、Lambda 全体が落ちないようにする。
export const parseHistory = (
    raw: string | null | undefined,
): RawMessage[] => {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((m: unknown) => {
            const obj = (m ?? {}) as Record<string, unknown>;
            return {
                role: typeof obj.role === 'string' ? obj.role : 'user',
                content:
                    typeof obj.content === 'string' ? obj.content : '',
            };
        });
    } catch {
        return [];
    }
};

// Bedrock Converse は user/assistant 交互で「先頭が user / 末尾が user ではない」
// 履歴を要求する。この後に新しい user 質問を追加する前提なので末尾の user は捨てる。
// 不正な role や空 content も除外する。
export const sanitizeHistory = (
    messages: RawMessage[],
): RawMessage[] => {
    const cleaned = messages.filter(
        (m) =>
            (m.role === 'user' || m.role === 'assistant')
            && m.content.trim() !== '',
    );
    // 先頭の assistant は捨てる (user 始まりに揃える)
    while (cleaned.length > 0 && cleaned[0].role === 'assistant') {
        cleaned.shift();
    }
    // 末尾の user は捨てる (この後に新質問の user を追加するため)
    while (
        cleaned.length > 0
        && cleaned[cleaned.length - 1].role === 'user'
    ) {
        cleaned.pop();
    }
    return cleaned;
};
