/**
 * AppSync Lambda Resolver: summarize
 *
 * 会話履歴を要約して Conversation.summary を更新するための Lambda。
 * - existingSummary: 既存の要約 (なければ空文字)
 * - messagesJson: 要約対象メッセージ群 [{role, content}] を JSON 文字列で受け取る
 *
 * 既存要約 + 新メッセージ群 を統合して新しい要約を生成する。
 * これにより、長期スレッドでも LLM への入力サイズをほぼ一定に保てる。
 */
import {
    BedrockRuntimeClient,
    ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { requireEnv } from '../_shared/env';

// 環境変数は Lambda 初期化時に即 throw して silently 動く事故を防ぐ (Issue #31)。
const MODEL_ID = requireEnv('MODEL_ID');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const runtimeClient = new BedrockRuntimeClient({ region: REGION });

const SYSTEM_PROMPT =
    'あなたは会話履歴を要約する専門家です。'
    + '与えられた会話履歴を、後続の会話で文脈として参照できるように、'
    + '事実関係・ユーザーの関心事・既出のキーワードを残して日本語で簡潔に要約してください。'
    + '冒頭に「これまでの会話の要約:」と書いてから、本文を続けてください。'
    + '個人情報の特定が可能な記述は控えてください。'
    + '要約は500字以内に収めてください。';

interface SummarizeArguments {
    existingSummary?: string | null;
    messagesJson: string;
}

interface SummarizeResponse {
    summary: string;
}

interface AppSyncEvent {
    arguments: SummarizeArguments;
}

interface RawMessage {
    role: string;
    content: string;
}

export const handler = async (
    event: AppSyncEvent,
): Promise<SummarizeResponse> => {
    // MODEL_ID は init-time に requireEnv で検証済み (Issue #31)。

    const existing = (event.arguments.existingSummary ?? '').trim();
    const raw = event.arguments.messagesJson ?? '';

    let messages: RawMessage[] = [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error('messagesJson は配列である必要があります');
        }
        messages = parsed.map((m: unknown) => {
            const obj = (m ?? {}) as Record<string, unknown>;
            return {
                role: typeof obj.role === 'string' ? obj.role : 'user',
                content: typeof obj.content === 'string' ? obj.content : '',
            };
        });
    } catch (err) {
        throw new Error(
            `messagesJson の JSON パースに失敗: ${(err as Error).message}`,
        );
    }

    // 要約対象が空なら既存要約をそのまま返す (副作用なし)
    if (messages.length === 0) {
        return { summary: existing };
    }

    const conversationText = messages
        .map((m) => `[${m.role}] ${m.content}`)
        .join('\n');

    const userPrompt = existing
        ? `これまでの要約:\n${existing}\n\n`
            + `新しい会話:\n${conversationText}\n\n`
            + '上記の要約と新しい会話を統合して、新しい要約を作成してください。'
        : `会話:\n${conversationText}\n\n`
            + '上記の会話を要約してください。';

    const resp = await runtimeClient.send(
        new ConverseCommand({
            modelId: MODEL_ID,
            system: [{ text: SYSTEM_PROMPT }],
            messages: [
                {
                    role: 'user',
                    content: [{ text: userPrompt }],
                },
            ],
            inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
        }),
    );

    const summary = resp.output?.message?.content?.[0]?.text ?? existing;
    return { summary };
};
