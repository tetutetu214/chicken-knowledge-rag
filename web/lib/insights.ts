// Issue #16 Phase 2 — `/insights` BI 画面の集計ロジック。
//
// 設計方針:
// - `app/insights/page.tsx` から呼び出す純関数のみ。React や Amplify Data には依存しない。
// - DOM や fetch を踏まないので Vitest の `environment: 'node'` でそのままテスト可能。
// - 家族 2 名 × 数百件規模を前提に、ソート・ペアリングは素朴な実装で十分。
//
// 詳細方針は docs/plan.md「Issue #16 Phase 2 — `/insights` BI 画面の実装方針」参照。

export interface InsightsMessage {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    hasKbResults: boolean | null;
    topScore: number | null;
    createdAt: string;
}

export interface UnresolvedQuestion {
    userId: string;
    userContent: string;
    userCreatedAt: string;
    assistantId: string;
    topScore: number | null;
    conversationId: string;
}

export interface MonthlyBucket {
    month: string;
    count: number;
}

export interface HistogramBucket {
    binStart: number;
    binEnd: number;
    label: string;
    count: number;
}

export interface InsightsSummary {
    totalQuestions: number;
    unresolvedQuestions: number;
    unresolvedLast30Days: number;
    avgTopScore: number | null;
}

// 1 回の chat ターン = user 1 メッセージ + assistant 1 メッセージ。
// 同じ conversation 内で createdAt 昇順にソートし、assistant の hasKbResults=false な行を見つけ、
// それより前で一番近い user 行をペアに採用する。途中に複数 user が連続するケースは想定しないが、
// もし起きても「直前の user」を取れば直感に合う。
export function pairUserAssistant(messages: InsightsMessage[]): UnresolvedQuestion[] {
    const byConv = new Map<string, InsightsMessage[]>();
    for (const m of messages) {
        const arr = byConv.get(m.conversationId) ?? [];
        arr.push(m);
        byConv.set(m.conversationId, arr);
    }

    const result: UnresolvedQuestion[] = [];
    for (const [conversationId, arr] of byConv) {
        const sorted = [...arr].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
        );
        for (let i = 0; i < sorted.length; i++) {
            const m = sorted[i];
            if (m.role !== 'assistant') continue;
            if (m.hasKbResults !== false) continue;
            // この assistant より前で一番近い user 行を逆方向に探す
            let prevUser: InsightsMessage | null = null;
            for (let j = i - 1; j >= 0; j--) {
                if (sorted[j].role === 'user') {
                    prevUser = sorted[j];
                    break;
                }
            }
            if (!prevUser) continue;
            result.push({
                userId: prevUser.id,
                userContent: prevUser.content,
                userCreatedAt: prevUser.createdAt,
                assistantId: m.id,
                topScore: m.topScore,
                conversationId,
            });
        }
    }
    return result.sort((a, b) => b.userCreatedAt.localeCompare(a.userCreatedAt));
}

// 過去 `months` ヶ月の YYYY-MM バケットを生成 (今月を含む)。空月もゼロで埋める。
// `now` は基準時刻 (テスト容易性のため引数化)、デフォルトは `new Date()`。
export function monthlyBuckets(
    questions: UnresolvedQuestion[],
    months: number,
    now: Date = new Date(),
): MonthlyBucket[] {
    const buckets = new Map<string, number>();
    // 古い月 → 新しい月の順で空バケットを用意
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.set(monthKey(d), 0);
    }
    for (const q of questions) {
        const d = new Date(q.userCreatedAt);
        const key = monthKey(d);
        if (buckets.has(key)) {
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
    }
    return Array.from(buckets, ([month, count]) => ({ month, count }));
}

function monthKey(d: Date): string {
    const y = d.getFullYear().toString().padStart(4, '0');
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
}

// assistant メッセージの topScore を `binSize` 刻みで 0〜1.0 のビンに集計。
// topScore が null のメッセージは除外。境界は [binStart, binEnd) で扱い、
// ちょうど 1.0 のレコードだけは最後のビン [0.95, 1.0] に含める (右端閉区間)。
export function topScoreHistogram(
    assistantMessages: InsightsMessage[],
    binSize: number = 0.05,
): HistogramBucket[] {
    if (binSize <= 0 || binSize > 1) {
        throw new Error(`binSize must be in (0, 1], got ${binSize}`);
    }
    const binCount = Math.round(1 / binSize);
    const buckets: HistogramBucket[] = [];
    for (let i = 0; i < binCount; i++) {
        const binStart = round2(i * binSize);
        const binEnd = round2((i + 1) * binSize);
        buckets.push({
            binStart,
            binEnd,
            label: `${binStart.toFixed(2)}-${binEnd.toFixed(2)}`,
            count: 0,
        });
    }
    for (const m of assistantMessages) {
        if (m.topScore == null) continue;
        if (m.topScore < 0 || m.topScore > 1) continue;
        // 浮動小数点誤差で 0.7 / 0.05 が 13.9999... になる事故を回避するため
        // 微小値を加算してから floor する。binSize=0.05、topScore は float32 精度なので
        // 1e-9 で実用上十分。
        let idx = Math.floor(m.topScore / binSize + 1e-9);
        if (idx >= binCount) idx = binCount - 1;
        buckets[idx].count += 1;
    }
    return buckets;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// 直近 N 日の Date を返す (基準時刻からの相対)。テスト容易性のため now を引数化。
function daysAgo(days: number, now: Date): Date {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
}

export function summarize(
    messages: InsightsMessage[],
    now: Date = new Date(),
): InsightsSummary {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    const unresolved = pairUserAssistant(messages);
    const threshold = daysAgo(30, now).toISOString();
    const last30 = unresolved.filter((q) => q.userCreatedAt >= threshold);

    const scored = assistantMessages.filter(
        (m): m is InsightsMessage & { topScore: number } => m.topScore != null,
    );
    const avg = scored.length === 0
        ? null
        : scored.reduce((s, m) => s + m.topScore, 0) / scored.length;

    return {
        totalQuestions: userMessages.length,
        unresolvedQuestions: unresolved.length,
        unresolvedLast30Days: last30.length,
        avgTopScore: avg,
    };
}

// CSV (RFC 4180 準拠): ダブルクォート・カンマ・改行を含むセルはダブルクォートで囲み、
// セル内のダブルクォートは "" にエスケープ。改行コードは CRLF。
// 列: createdAt, question, topScore, conversationTitle, conversationId
export function toCsv(
    questions: UnresolvedQuestion[],
    conversationTitles: Map<string, string>,
): string {
    const header = [
        'createdAt',
        'question',
        'topScore',
        'conversationTitle',
        'conversationId',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const q of questions) {
        const cells = [
            q.userCreatedAt,
            q.userContent,
            q.topScore == null ? '' : q.topScore.toString(),
            conversationTitles.get(q.conversationId) ?? '',
            q.conversationId,
        ];
        lines.push(cells.map(csvCell).join(','));
    }
    return lines.join('\r\n');
}

function csvCell(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
