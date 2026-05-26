/**
 * Query Expansion (Conditional Retry 方式) — Issue #31 派生スコープ。
 *
 * 目的:
 * ユーザの日常語 (例「首の骨」) と KB の専門語 (例「頚椎」) の語彙ギャップで
 * topScore が閾値以下に沈む取りこぼしを救済する。
 *
 * 方式 (knowledge.md 2026-05-26「Conditional Retry のトレードオフ」参照):
 * 元クエリの topScore が「拡張帯」(lowerThreshold 以上、upperThreshold 未満) に
 * 入った時だけ Nova Pro でリフォーム文を生成し、各リフォーム文で追加 Retrieve、
 * 結果をマージして再判定。topScore < lowerThreshold (KB に無い) と
 * topScore >= upperThreshold (KB ヒット明確) はバイパス = コスト増ゼロ。
 *
 * 救済成功 (新 topScore が upperThreshold 以上) のときだけマージ結果を返す。
 * 失敗時は元結果をそのまま返して KB ヒットなし扱いに進む (不確実な拡張結果で
 * 答えるより KB なし警告のほうが精度最優先方針と整合)。
 *
 * 純関数中心の設計で、handler.ts から AWS SDK クライアントを渡してもらう形にして
 * Vitest で単体テストできる構造にしている。
 */
import {
    BedrockRuntimeClient,
    ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
    BedrockAgentRuntimeClient,
    RetrieveCommand,
    type KnowledgeBaseRetrievalResult,
} from '@aws-sdk/client-bedrock-agent-runtime';

export interface QueryExpansionConfig {
    /** false なら一切の拡張処理をスキップ (= 既存挙動と完全一致) */
    enabled: boolean;
    /** 拡張帯の下限 (例 0.62)。これ以上なら拡張対象 */
    lowerThreshold: number;
    /** 拡張帯の上限 = 既存 SCORE_THRESHOLD と同値 (例 0.7)。これ未満なら拡張対象 */
    upperThreshold: number;
    /** リフォーム文の最大数 (例 2)。0 以下なら拡張無効 */
    maxReformulations: number;
    /** リフォーム生成に使う LLM の modelId (例: APAC Nova Pro Inference Profile) */
    modelId: string;
}

export interface ExpansionResult {
    /** 最終的に handler が使う retrievalResults (救済成功なら merged、失敗なら元) */
    results: KnowledgeBaseRetrievalResult[];
    /** results の最高スコア */
    topScore: number;
    /** 拡張処理を試みたか (帯内で reformulate を呼んだか) */
    expansionAttempted: boolean;
    /** 救済成功したか (新 topScore が upperThreshold 以上) */
    expansionRescued: boolean;
    /** 生成されたリフォーム文 (ログ・観測用) */
    reformulations: string[];
}

/**
 * retrievalResults の最高スコア。空配列なら 0。
 */
export const computeTopScore = (
    results: KnowledgeBaseRetrievalResult[],
): number => {
    if (results.length === 0) return 0;
    return Math.max(...results.map((r) => r.score ?? 0));
};

/**
 * 拡張帯 (lowerThreshold 以上、upperThreshold 未満) に topScore が入るかを判定する。
 *
 * 境界値の扱い:
 * - upperThreshold ジャストは false (= KB ヒット明確帯、現状の挙動に従う)
 * - lowerThreshold ジャストは true (= 拡張帯、救済の機会を作る)
 *
 * enabled=false や maxReformulations<=0 は閾値関係なく false (= バイパス)。
 */
export const shouldExpand = (
    topScore: number,
    config: QueryExpansionConfig,
): boolean => {
    if (!config.enabled) return false;
    if (config.maxReformulations <= 0) return false;
    return topScore >= config.lowerThreshold
        && topScore < config.upperThreshold;
};

const REFORMULATION_SYSTEM_PROMPT = `あなたは検索クエリのリフォーマーです。
与えられた質問を、同じ意味のまま別の表現や類義語で言い換えてください。

ルール:
- 必ず日本語で書く
- 鶏飼育に関する専門用語と日常用語のギャップを意識する
  (例: 「首の骨」→「頚椎」、「フラフラ」→「運動失調」、「鶏小屋」→「鶏舎」、「卵が腐る」→「卵の腐敗」)
- 元の質問の意図を保つ (新しい情報を加えない)
- リフォーム文ごとに改行 1 個で区切る
- それ以外の説明・前置き・番号付けは一切出さない (リフォーム文のみ)`;

/**
 * Nova Pro (modelId は config から) にリフォーム文を生成させる。
 * 失敗時は空配列を返して handler 側でバイパスする (元クエリの結果でそのまま続行)。
 *
 * 出力パース:
 * - 改行区切りで split
 * - 各行の先頭にある番号付け (「1. 」「- 」「・」) は除去 (LLM が指示無視で付けてくるケースの fallback)
 * - 元の質問と同じ文、リフォーム文同士の重複は除去
 * - maxReformulations 件で打ち切り
 */
export const reformulateQuery = async (
    question: string,
    runtimeClient: BedrockRuntimeClient,
    config: QueryExpansionConfig,
): Promise<string[]> => {
    if (!config.enabled || config.maxReformulations <= 0) return [];
    if (!question.trim()) return [];

    const userPrompt =
        `元の質問:\n${question}\n\nリフォーム文を ${config.maxReformulations} 個書いてください:`;

    let text: string;
    try {
        const resp = await runtimeClient.send(
            new ConverseCommand({
                modelId: config.modelId,
                system: [{ text: REFORMULATION_SYSTEM_PROMPT }],
                messages: [
                    { role: 'user', content: [{ text: userPrompt }] },
                ],
                inferenceConfig: { maxTokens: 300, temperature: 0.5 },
            }),
        );
        text = resp.output?.message?.content?.[0]?.text ?? '';
    } catch (err) {
        console.warn(
            '[QueryExpansion] reformulateQuery failed, fallback to empty:',
            err,
        );
        return [];
    }

    if (!text.trim()) return [];

    const seen = new Set<string>([question.trim()]);
    const reformulations: string[] = [];
    for (const line of text.split('\n')) {
        // 先頭の番号付けや箇条書き記号を除去 (「1. 」「- 」「・」「* 」など)
        const cleaned = line.trim().replace(/^[\d]+[\.\)]\s*|^[\-\*・]\s*/, '').trim();
        if (!cleaned) continue;
        if (seen.has(cleaned)) continue;
        seen.add(cleaned);
        reformulations.push(cleaned);
        if (reformulations.length >= config.maxReformulations) break;
    }
    return reformulations;
};

/**
 * 複数の retrievalResults をマージし、重複除去 + スコア降順ソートで返す。
 *
 * 重複判定: location.s3Location.uri + metadata の page 番号を複合キーにする。
 * 同じキーで複数結果が来た場合、score が高い方を残す (chunk が同じでも別 query で
 * 別 score が返るケースがあるため)。
 */
export const mergeRetrievalResults = (
    ...resultArrays: KnowledgeBaseRetrievalResult[][]
): KnowledgeBaseRetrievalResult[] => {
    const seen = new Map<string, KnowledgeBaseRetrievalResult>();
    for (const results of resultArrays) {
        for (const r of results) {
            const uri = r.location?.s3Location?.uri ?? '';
            const page = r.metadata?.['x-amz-bedrock-kb-document-page-number'];
            const key = `${uri}#${page ?? ''}`;
            const existing = seen.get(key);
            if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
                seen.set(key, r);
            }
        }
    }
    return [...seen.values()].sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
};

/**
 * 元の Retrieve 結果が「取りこぼし疑い帯」だった場合に、
 * Nova Pro リフォーム + 追加 Retrieve + マージで救済を試みる。
 *
 * 救済成功 (新 topScore が upperThreshold 以上) のときだけマージ結果を返す。
 * 救済失敗時は元結果を返す (KB ヒットなし扱いに進む方が精度最優先方針と整合)。
 * 拡張帯外なら一切処理せずバイパスする (コスト増ゼロ)。
 *
 * リフォーム後の Retrieve は Promise.allSettled で並列実行し、失敗があっても
 * 残りで続行する。
 */
export const expandIfNeeded = async (
    question: string,
    originalResults: KnowledgeBaseRetrievalResult[],
    config: QueryExpansionConfig,
    runtimeClient: BedrockRuntimeClient,
    agentClient: BedrockAgentRuntimeClient,
    knowledgeBaseId: string,
): Promise<ExpansionResult> => {
    const originalTopScore = computeTopScore(originalResults);

    if (!shouldExpand(originalTopScore, config)) {
        return {
            results: originalResults,
            topScore: originalTopScore,
            expansionAttempted: false,
            expansionRescued: false,
            reformulations: [],
        };
    }

    console.log(
        '[QueryExpansion] attempting expansion:'
        + ` original="${question}", topScore_before=${originalTopScore}`,
    );

    const reformulations = await reformulateQuery(
        question,
        runtimeClient,
        config,
    );

    if (reformulations.length === 0) {
        console.log(
            '[QueryExpansion] no reformulations generated, fallback to original',
        );
        return {
            results: originalResults,
            topScore: originalTopScore,
            expansionAttempted: true,
            expansionRescued: false,
            reformulations: [],
        };
    }

    const settledRetrieves = await Promise.allSettled(
        reformulations.map((r) =>
            agentClient.send(
                new RetrieveCommand({
                    knowledgeBaseId,
                    retrievalQuery: { text: r },
                    retrievalConfiguration: {
                        vectorSearchConfiguration: { numberOfResults: 5 },
                    },
                }),
            ),
        ),
    );

    const allExpanded: KnowledgeBaseRetrievalResult[][] = [];
    for (const settled of settledRetrieves) {
        if (settled.status === 'fulfilled') {
            allExpanded.push(settled.value.retrievalResults ?? []);
        } else {
            console.warn(
                '[QueryExpansion] expanded retrieve failed:',
                settled.reason,
            );
        }
    }

    const merged = mergeRetrievalResults(originalResults, ...allExpanded);
    const newTopScore = computeTopScore(merged);
    const rescued = newTopScore >= config.upperThreshold;

    console.log(
        '[QueryExpansion]'
        + ` reformulations=${JSON.stringify(reformulations)}`
        + `, topScore_after=${newTopScore}`
        + `, rescued=${rescued}`,
    );

    return {
        results: rescued ? merged : originalResults,
        topScore: rescued ? newTopScore : originalTopScore,
        expansionAttempted: true,
        expansionRescued: rescued,
        reformulations,
    };
};
