/**
 * AppSync Lambda Resolver: chat
 *
 * Bedrock Knowledge Base を「必ず」引いた上で、ヒット有無で応答ロジックを分岐する。
 * - ヒットあり: KB 抜粋を system prompt に <source id="S1"> 形式で埋め込んで Converse
 * - ヒットなし: Converse のみ (一般知識回答、冒頭で出典未検証を明示)
 *
 * 履歴渡し:
 * - historyJson: 直近メッセージ履歴 ([{role, content}])。Converse の messages 配列に積む。
 * - summary: それより古い履歴の要約。system prompt に追記。
 *
 * 専門家相談の付与方針 (Issue #18、2026-05-05):
 * 5カテゴリに触れただけで一律「専門家に相談してください」を付ける旧仕様は廃止。
 * リスク階層 L1 (一般知識・付けない) / L2 (軽い注意・1セッション1回) / L3 (緊急・必須) で
 * 出し分ける。alert fatigue (医療情報学) 回避のため。
 *
 * 引用フォーマット (Issue #18):
 * 本文中に [S1][S2] のインライン引用 + 末尾に「## 出典」セクションを LLM に書かせる。
 * フロントの📄チップ表示 (Citation 配列) は併存。
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

const NO_CONTEXT_PREFIX = '※ 一般知識に基づく回答です（出典未検証）コケ';

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

    parts.push(
        'あなたは「コケ先輩」、ペット鶏150羽の飼育を見守るベテラン鶏アシスタントです。'
        + '家族2名（うち1名はスマートフォンから利用）が日常の飼育判断に使います。',
    );

    parts.push(
        '<persona>\n'
        + '- 全文の語尾は必ず「コケ」で締める（例: 「水をこまめに替えるといいコケ」）\n'
        + '- フレンドリーで安心感のある先輩キャラ\n'
        + '- 大げさな前置き・自己紹介・謝罪は省く\n'
        + '</persona>',
    );

    parts.push(
        '<response_length>\n'
        + '- スマートフォン閲覧が前提。簡潔さを最優先する\n'
        + '- 簡単な質問（事実確認・短い助言）: 2〜3文、おおむね100字以内\n'
        + '- 中程度の質問（手順・選択肢の比較）: 3〜5段落、おおむね400字以内\n'
        + '- 複雑な質問（症状の切り分け・複数要因の判断）: 最大で約800字\n'
        + '- ユーザーが「詳しく」「もっと教えて」と明示した場合のみ上限を超えてよい\n'
        + '- 不要な前置き、要約の繰り返し、自己慶賀的なフレーズは入れない\n'
        + '</response_length>',
    );

    if (summary && summary.trim()) {
        parts.push(`これまでの会話の要約:\n${summary.trim()}`);
    }

    if (hasKb && kbContext) {
        parts.push(
            '<sources>\n'
            + '以下に検索結果を <source id="S1" filename="..." page="..."> 形式で渡す。回答は原則これらに基づくこと。\n'
            + '本文中で根拠箇所には [S1] [S2] のように番号で引用する。\n'
            + '末尾に必ず「## 出典」セクションを置き、引用した番号ごとに「[S1] ファイル名 (page N)」を列挙する。\n'
            + 'KB に明確な答えが無い場合は「KB に該当情報はありませんでしたコケ」と先頭で断り、一般知識で補う旨を明記する。\n'
            + '</sources>',
        );
        parts.push('---参考資料抜粋---');
        parts.push(kbContext);
        parts.push('---ここまで---');
    } else {
        parts.push(
            '<sources>\n'
            + `今回はKBヒットなし。一般的な飼育知識で答えるが、応答冒頭に「${NO_CONTEXT_PREFIX}」と明示すること。\n`
            + '出典セクションは省略してよい。\n'
            + '</sources>',
        );
    }

    parts.push(
        '<expert_referral>\n'
        + '専門家相談の促し文は、以下のリスク階層に従って出し分ける。**該当しない質問には付けない**。\n\n'
        + '- L1（付けない）: 餌・水・床材・行動・性格・環境設計・季節対策・繁殖・換羽など、生命に関わらない一般的な飼育知識\n'
        + '- L2（控えめに、1応答で1回だけ）: 軽い不調や病気の一般情報、餌の安全性の一般論。\n'
        + '  → 末尾に短く「気になる様子が続くなら獣医に相談すると安心コケ」を1回だけ。\n'
        + '  → ただし、これまでの会話履歴で既に同じ専門家相談文を出している場合は、今回は省略する。\n'
        + '- L3（必ず明示）: 以下のいずれかに該当する場合のみ、明確な相談促しを必ず付ける\n'
        + '    - 具体的な症状の記述+治療判断（投薬可否・薬剤名・用量）\n'
        + '    - 緊急対応（呼吸困難、痙攣、大量出血、意識消失、急激な衰弱）\n'
        + '    - 卵・鶏肉の食品安全判断（生食可否、加熱条件、腐敗判断、廃棄判断）\n'
        + '    - 害獣の捕獲・駆除（鳥獣保護管理法に関わる判断）\n'
        + '    - 人獣共通感染症の疑い\n'
        + '  → 末尾に「**この件は獣医・保健所など専門家の判断が必要コケ。すぐに相談してコケ**」を明確に付ける\n\n'
        + '**重要**: L1・L2の質問にL3相当の警告を付けてはならない。過剰な警告は本当に重要な警告を見過ごす原因になる（医療情報学でいう alert fatigue）。\n'
        + '</expert_referral>',
    );

    parts.push(
        '<output_format>\n'
        + '1. 回答本文（必要に応じて [S1] [S2] 形式の引用）\n'
        + '2. （L2/L3該当時のみ）専門家相談の一文\n'
        + '3. （KB ヒットあり時のみ）## 出典 セクション\n'
        + '</output_format>',
    );

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
        let sourceIdx = 1;
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
            const sourceId = `S${sourceIdx}`;
            const pageAttr = page != null ? ` page="${page}"` : '';
            kbBlocks.push(
                `<source id="${sourceId}" filename="${filename}"${pageAttr}>\n${text}\n</source>`,
            );
            const key = `${uri}#${page ?? ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                citations.push({
                    uri,
                    page: Number.isFinite(page) ? (page as number) : null,
                });
            }
            sourceIdx++;
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
            inferenceConfig: { maxTokens: 1500, temperature: 0.3 },
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
