/**
 * AppSync Lambda Resolver: chat
 *
 * Bedrock Knowledge Base を「必ず」引いた上で、ヒット有無で応答ロジックを分岐する。
 * - ヒットあり: RetrieveAndGenerate (KB ベース回答 + 引用元)
 * - ヒットなし: Converse API (LLM 一般知識回答、冒頭に⚠表示)
 *
 * spec.md §5-2 「ハルシネーション抑制最優先・出典必須」を構造的に強制するため、
 * LLM が KB を引くか否かの判断には任せず、Lambda 側で機械的に Retrieve を実行する。
 */
import {
    BedrockRuntimeClient,
    ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
    BedrockAgentRuntimeClient,
    RetrieveCommand,
    RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const KB_ID = process.env.KNOWLEDGE_BASE_ID ?? '';
const MODEL_ARN = process.env.MODEL_ARN ?? '';
const MODEL_ID = process.env.MODEL_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

// KB ヒットありと判定する最低類似度スコア (cosine 0.0〜1.0)。
// S3 Vectors は閾値なしで top-K を必ず返すため、類似度が低い結果は
// 「無関係な質問」として KB なし扱いに振り分ける必要がある。
// 実測: 無関連質問「鶏の鳴き声を音楽にしたい」で top=0.68 → 鶏キーワード
// 共通で底上げされるため 0.7 に設定。ログを見て継続調整する。
const SCORE_THRESHOLD = 0.7;

const agentClient = new BedrockAgentRuntimeClient({ region: REGION });
const runtimeClient = new BedrockRuntimeClient({ region: REGION });

const NO_CONTEXT_PREFIX = '⚠ 参考資料にはありません。一般的な知識ですが、';

const SYSTEM_PROMPT_NO_KB =
    'あなたは鶏(ペット飼育)の飼育専門家です。'
    + 'ユーザーの質問に対して、あなた自身の一般的な知識で回答してください。'
    + `回答の冒頭に必ず「${NO_CONTEXT_PREFIX}」を付けてください。`
    + '疾病・薬剤・緊急対応・害獣捕獲・卵食品安全に関する内容を含む場合は、'
    + '必ず「専門家に相談してください」という旨を末尾に添えてください。';

interface ChatArguments {
    question: string;
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

export const handler = async (event: AppSyncEvent): Promise<ChatResponse> => {
    const question = (event.arguments?.question ?? '').trim();
    if (!question) {
        throw new Error('question is required');
    }
    if (!KB_ID || !MODEL_ARN || !MODEL_ID) {
        throw new Error(
            'KNOWLEDGE_BASE_ID / MODEL_ARN / MODEL_ID 環境変数が未設定',
        );
    }

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

    // 類似度スコアが閾値以上のヒットがあるかで判定 (length 単独だと
    // S3 Vectors が top-K を機械的に返すため、無関係質問でも常に true になる)
    const scores = (retrieveResp.retrievalResults ?? []).map(
        (r) => r.score ?? 0,
    );
    const topScore = scores.length > 0 ? Math.max(...scores) : 0;
    const hasResults = topScore >= SCORE_THRESHOLD;
    console.log('KB retrieve scores:', scores, 'topScore:', topScore);

    if (hasResults) {
        // ヒットあり: KB を根拠に回答生成
        const ragResp = await agentClient.send(
            new RetrieveAndGenerateCommand({
                input: { text: question },
                retrieveAndGenerateConfiguration: {
                    type: 'KNOWLEDGE_BASE',
                    knowledgeBaseConfiguration: {
                        knowledgeBaseId: KB_ID,
                        modelArn: MODEL_ARN,
                    },
                },
            }),
        );

        const citations: Citation[] = [];
        for (const cite of ragResp.citations ?? []) {
            for (const ref of cite.retrievedReferences ?? []) {
                const uri = ref.location?.s3Location?.uri ?? '';
                const meta = ref.metadata as
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
                citations.push({
                    uri,
                    page: Number.isFinite(page) ? (page as number) : null,
                });
            }
        }

        return {
            answer: ragResp.output?.text ?? '',
            citations,
            hasKbResults: true,
        };
    }

    // ヒットなし: LLM 一般知識で回答 (冒頭に⚠表示を強制)
    const converseResp = await runtimeClient.send(
        new ConverseCommand({
            modelId: MODEL_ID,
            system: [{ text: SYSTEM_PROMPT_NO_KB }],
            messages: [
                {
                    role: 'user',
                    content: [{ text: question }],
                },
            ],
            inferenceConfig: { maxTokens: 1024, temperature: 0.3 },
        }),
    );

    const answerText =
        converseResp.output?.message?.content?.[0]?.text ?? '';

    return {
        answer: answerText,
        citations: [],
        hasKbResults: false,
    };
};
