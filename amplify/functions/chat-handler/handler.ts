/**
 * AppSync Lambda Resolver: chat
 *
 * Bedrock Knowledge Base を「必ず」引いた上で、ヒット有無で応答ロジックを分岐する。
 * - ヒットあり: KB 抜粋を system prompt に埋め込んで Converse、citations は Retrieve 結果から構築
 * - ヒットなし: Converse のみ (一般知識回答、冒頭⚠表示を強制)
 *
 * 履歴渡し:
 * - historyJson: 直近メッセージ履歴 ([{role, content}])。Converse の messages 配列に積む。
 * - summary: それより古い履歴の要約。system prompt に追記。
 *
 * spec.md §5-2「ハルシネーション抑制最優先・出典必須」を構造的に強制するため、
 * LLM が KB を引くか否かの判断には任せず、Lambda 側で機械的に Retrieve を実行する。
 *
 * B-3 前半は RetrieveAndGenerate を使っていたが、履歴対応のため B-3 後半で
 * Retrieve + 自前 system prompt + Converse 構成に統一した。citations は
 * Retrieve 結果から重複除去して全件返す。
 */
import {
    BedrockRuntimeClient,
    ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
    BedrockAgentRuntimeClient,
    RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const KB_ID = process.env.KNOWLEDGE_BASE_ID ?? '';
const MODEL_ID = process.env.MODEL_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

// KB ヒットありと判定する最低類似度スコア (cosine 0.0〜1.0)。
// S3 Vectors は閾値なしで top-K を必ず返すため、類似度が低い結果は
// 「無関係な質問」として KB なし扱いに振り分ける必要がある。
// 実測: 無関連質問「鶏の鳴き声を音楽にしたい」で top=0.66、関連質問で 0.87。
// 中間値の 0.7 を閾値に設定。CloudWatch Logs を見て継続調整する。
const SCORE_THRESHOLD = 0.7;

const agentClient = new BedrockAgentRuntimeClient({ region: REGION });
const runtimeClient = new BedrockRuntimeClient({ region: REGION });

const NO_CONTEXT_PREFIX = '⚠ 参考資料にはありません。一般的な知識ですが、';

interface ChatArguments {
    question: string;
    historyJson?: string | null;
    summary?: string | null;
}

interface Citation {
    uri: string;
    page: number | null;
}

interface ChatResponse {
    answer: string;
    citations: Citation[];
    hasKbResults: boolean;
}

interface AppSyncEvent {
    arguments: ChatArguments;
}

interface RawMessage {
    role: string;
    content: string;
}

const parseHistory = (raw: string | null | undefined): RawMessage[] => {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((m: unknown) => {
            const obj = (m ?? {}) as Record<string, unknown>;
            return {
                role: typeof obj.role === 'string' ? obj.role : 'user',
                content: typeof obj.content === 'string' ? obj.content : '',
            };
        });
    } catch {
        return [];
    }
};

// Converse は user/assistant 交互で始まりが user、末尾が user (最新質問の前) である必要がある。
// 履歴を防御的にクリーンアップする。
const sanitizeHistory = (messages: RawMessage[]): RawMessage[] => {
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

const buildSystemPrompt = (params: {
    hasKb: boolean;
    kbContext?: string;
    summary?: string;
}): string => {
    const { hasKb, kbContext, summary } = params;
    const parts: string[] = [];
    parts.push('あなたは鶏 (ペット飼育) の飼育に関する専門家です。');
    if (summary && summary.trim()) {
        parts.push(`これまでの会話の要約:\n${summary.trim()}`);
    }
    if (hasKb && kbContext) {
        parts.push(
            '以下は質問に関連する参考資料の抜粋です。'
            + '回答はこれらの抜粋に基づいて作成し、'
            + '本文中で出典 (ファイル名・ページ番号) を必ず明示してください。',
        );
        parts.push('---参考資料抜粋---');
        parts.push(kbContext);
        parts.push('---ここまで---');
        parts.push(
            '疾病・薬剤・緊急対応・害獣捕獲・卵食品安全に関する内容を含む場合は、'
            + '末尾に「専門家に相談してください」を必ず添えてください。',
        );
    } else {
        parts.push(
            'ユーザーの質問に対して、あなた自身の一般的な知識で回答してください。'
            + `回答の冒頭に必ず「${NO_CONTEXT_PREFIX}」を付けてください。`
            + '疾病・薬剤・緊急対応・害獣捕獲・卵食品安全に関する内容を含む場合は、'
            + '末尾に「専門家に相談してください」を必ず添えてください。',
        );
    }
    return parts.join('\n\n');
};

export const handler = async (event: AppSyncEvent): Promise<ChatResponse> => {
    const question = (event.arguments?.question ?? '').trim();
    if (!question) {
        throw new Error('question is required');
    }
    if (!KB_ID || !MODEL_ID) {
        throw new Error('KNOWLEDGE_BASE_ID / MODEL_ID 環境変数が未設定');
    }

    const history = sanitizeHistory(parseHistory(event.arguments.historyJson));
    const summary = (event.arguments.summary ?? '').trim();

    // KB を必ず引く (LLM の判断に委ねない)
    const retrieveResp = await agentClient.send(
        new RetrieveCommand({
            knowledgeBaseId: KB_ID,
            retrievalQuery: { text: question },
            retrievalConfiguration: {
                vectorSearchConfiguration: { numberOfResults: 5 },
            },
        }),
    );

    const scores = (retrieveResp.retrievalResults ?? []).map(
        (r) => r.score ?? 0,
    );
    const topScore = scores.length > 0 ? Math.max(...scores) : 0;
    const hasResults = topScore >= SCORE_THRESHOLD;
    console.log('KB retrieve scores:', scores, 'topScore:', topScore);

    // KB ヒット時は抜粋を文字列化、citations は重複除去で構築
    let kbContext: string | undefined;
    let citations: Citation[] = [];
    if (hasResults) {
        const kbBlocks: string[] = [];
        const seen = new Set<string>();
        for (const r of retrieveResp.retrievalResults ?? []) {
            const uri = r.location?.s3Location?.uri ?? '';
            const meta = r.metadata as
                | Record<string, unknown>
                | undefined;
            const pageRaw =
                meta?.['x-amz-bedrock-kb-document-page-number'];
            const page =
                typeof pageRaw === 'number'
                    ? pageRaw
                    : typeof pageRaw === 'string'
                        ? Number.parseInt(pageRaw, 10)
                        : null;
            const filename = uri.split('/').pop() || uri;
            const text = r.content?.text ?? '';
            kbBlocks.push(
                `【出典: ${filename}${page != null ? ` p${page}` : ''}】\n${text}`,
            );
            const key = `${uri}#${page ?? ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                citations.push({
                    uri,
                    page: Number.isFinite(page) ? (page as number) : null,
                });
            }
        }
        kbContext = kbBlocks.join('\n\n');
    }

    const systemPrompt = buildSystemPrompt({
        hasKb: hasResults,
        kbContext,
        summary,
    });

    // 履歴 + 新質問を Converse messages に積む
    const messages: { role: 'user' | 'assistant'; content: { text: string }[] }[] =
        history.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: [{ text: m.content }],
        }));
    messages.push({
        role: 'user',
        content: [{ text: question }],
    });

    const converseResp = await runtimeClient.send(
        new ConverseCommand({
            modelId: MODEL_ID,
            system: [{ text: systemPrompt }],
            messages,
            inferenceConfig: { maxTokens: 2048, temperature: 0.3 },
        }),
    );

    const answerText =
        converseResp.output?.message?.content?.[0]?.text ?? '';

    return {
        answer: answerText,
        citations: hasResults ? citations : [],
        hasKbResults: hasResults,
    };
};
