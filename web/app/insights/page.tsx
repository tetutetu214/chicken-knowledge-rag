'use client';

// Issue #16 Phase 2 — KB 不足領域分析ダッシュボード。
//
// 目的: 「KB根拠なし質問 (cosine 類似度 < SCORE_THRESHOLD)」を可視化し、
// てつてつが「どの領域の資料を追加で入れるべきか」を判断する材料を出す。
//
// 認証は layout.tsx の AuthenticatorWrapper でラップ済み (家族メンバー のみ閲覧可)。
// データ取得方針・recharts 採用理由は docs/plan.md「Issue #16 Phase 2 — `/insights` BI 画面の実装方針」参照。

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/data';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { Schema } from '../../../amplify/data/resource';
import { CONVERSATION_FIELDS, MESSAGE_FIELDS } from '../../lib/selectionSets';
import {
    type InsightsMessage,
    monthlyBuckets,
    pairUserAssistant,
    summarize,
    toCsv,
    topScoreHistogram,
} from '../../lib/insights';

const client = generateClient<Schema>();

// SCORE_THRESHOLD は chat-handler 側と一致させる (0.70)。閾値の参照線として描画する。
const SCORE_THRESHOLD = 0.7;

export default function InsightsPage() {
    const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
    const [messages, setMessages] = useState<InsightsMessage[]>([]);
    const [conversationTitles, setConversationTitles] = useState<Map<string, string>>(
        new Map(),
    );
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            // 家族のみで数百件規模を想定。filter は使わずフロントで仕分ける。
            // 大規模化したら filter / GSI / pagination の順で検討 (plan.md 参照)。
            const [msgRes, convRes] = await Promise.all([
                client.models.Message.list({
                    limit: 1000,
                    selectionSet: MESSAGE_FIELDS,
                }),
                client.models.Conversation.list({
                    limit: 1000,
                    selectionSet: CONVERSATION_FIELDS,
                }),
            ]);
            if (msgRes.errors && msgRes.errors.length > 0) {
                throw new Error(msgRes.errors.map((e) => e.message).join(' / '));
            }
            if (convRes.errors && convRes.errors.length > 0) {
                throw new Error(convRes.errors.map((e) => e.message).join(' / '));
            }
            const msgs: InsightsMessage[] = (msgRes.data ?? []).map((d) => ({
                id: d.id,
                conversationId: d.conversationId,
                role: d.role,
                content: d.content,
                hasKbResults: d.hasKbResults ?? null,
                topScore: d.topScore ?? null,
                createdAt: d.createdAt,
            }));
            const titles = new Map(
                (convRes.data ?? []).map((c) => [c.id, c.title] as const),
            );
            setMessages(msgs);
            setConversationTitles(titles);
            setLoaded(true);
            setError(null);
        } catch (e) {
            console.error('[insights] load failed', e);
            setError(e instanceof Error ? e.message : String(e));
            // 失敗時もマーカーは立てる (E2E がローダー画面で永久に待たないように)
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const unresolved = useMemo(() => pairUserAssistant(messages), [messages]);
    const monthly = useMemo(() => monthlyBuckets(unresolved, 12), [unresolved]);
    const histogram = useMemo(
        () => topScoreHistogram(messages.filter((m) => m.role === 'assistant'), 0.05),
        [messages],
    );
    const stats = useMemo(() => summarize(messages), [messages]);

    const handleCsvDownload = () => {
        const csv = toCsv(unresolved, conversationTitles);
        // BOM 付きで UTF-8 保存すると Excel で文字化けしない
        const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `kb-miss-${ts}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <main
            data-insights-loaded={loaded ? 'true' : 'false'}
            className="min-h-screen bg-zinc-50 dark:bg-zinc-900 p-4 md:p-8"
        >
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                            📊 KB不足領域分析
                        </h1>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            KB根拠なし質問 (top-K 最大コサイン類似度 &lt; {SCORE_THRESHOLD}) を見返して、追加すべき公的資料・現場ナレッジを判断するための画面
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <Link
                            href="/"
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            ← 会話に戻る
                        </Link>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            <span className="block truncate max-w-[12rem]">
                                {user?.signInDetails?.loginId ?? user?.username}
                            </span>
                            <button
                                onClick={signOut}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                サインアウト
                            </button>
                        </div>
                    </div>
                </header>

                {error && (
                    <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
                        Error: {error}
                    </div>
                )}

                {/* サマリーカード 4 枚 */}
                <section
                    data-testid="insights-summary"
                    className="grid grid-cols-2 md:grid-cols-4 gap-3"
                >
                    <SummaryCard label="全質問数" value={stats.totalQuestions} />
                    <SummaryCard
                        label="KB根拠なし数"
                        value={stats.unresolvedQuestions}
                        emphasize
                    />
                    <SummaryCard
                        label="直近30日の未解決"
                        value={stats.unresolvedLast30Days}
                    />
                    <SummaryCard
                        label="assistant 平均 topScore"
                        value={
                            stats.avgTopScore == null
                                ? '—'
                                : stats.avgTopScore.toFixed(3)
                        }
                    />
                </section>

                {/* 月次棒グラフ */}
                <section
                    data-testid="insights-monthly"
                    className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4"
                >
                    <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                        月次 KB根拠なし質問 (直近 12 ヶ月)
                    </h2>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthly}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="count" fill="#3b82f6" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                {/* topScore ヒストグラム */}
                <section
                    data-testid="insights-histogram"
                    className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4"
                >
                    <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                        assistant topScore 分布 (0.05 刻み、縦線が閾値 {SCORE_THRESHOLD})
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                        閾値より左にデータが多ければ「KBが薄い領域」が多い証拠。
                        閾値右の鋭いピークは「もう少しで KB ヒットになる」帯。
                    </p>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogram}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                                <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <ReferenceLine
                                    x={`${SCORE_THRESHOLD.toFixed(2)}-${(SCORE_THRESHOLD + 0.05).toFixed(2)}`}
                                    stroke="#dc2626"
                                    strokeDasharray="4 4"
                                    label={{ value: `閾値 ${SCORE_THRESHOLD}`, position: 'top', fontSize: 10, fill: '#dc2626' }}
                                />
                                <Bar dataKey="count">
                                    {histogram.map((b, i) => (
                                        <Cell
                                            key={i}
                                            fill={b.binStart < SCORE_THRESHOLD ? '#f59e0b' : '#10b981'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                {/* 未解決質問一覧 + CSV ダウンロード */}
                <section
                    data-testid="insights-table"
                    className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4"
                >
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                            未解決質問一覧 ({unresolved.length}件)
                        </h2>
                        <button
                            type="button"
                            onClick={handleCsvDownload}
                            disabled={unresolved.length === 0}
                            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-3 rounded"
                            data-testid="insights-csv-button"
                        >
                            CSVダウンロード
                        </button>
                    </div>
                    {unresolved.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
                            まだ KB根拠なし質問はありません。
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                        <th className="py-2 pr-3 font-medium">日時</th>
                                        <th className="py-2 pr-3 font-medium">質問</th>
                                        <th className="py-2 pr-3 font-medium text-right">topScore</th>
                                        <th className="py-2 pr-3 font-medium">会話タイトル</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {unresolved.map((q) => (
                                        <tr
                                            key={q.assistantId}
                                            className="border-b border-zinc-100 dark:border-zinc-800"
                                        >
                                            <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                                                {formatDate(q.userCreatedAt)}
                                            </td>
                                            <td className="py-2 pr-3 text-zinc-800 dark:text-zinc-200">
                                                <div className="max-w-md line-clamp-2">
                                                    {q.userContent}
                                                </div>
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                {q.topScore == null ? '—' : q.topScore.toFixed(3)}
                                            </td>
                                            <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400 truncate max-w-xs">
                                                {conversationTitles.get(q.conversationId) ?? '(タイトル不明)'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

function SummaryCard({
    label,
    value,
    emphasize,
}: {
    label: string;
    value: number | string;
    emphasize?: boolean;
}) {
    return (
        <div
            className={`bg-white dark:bg-zinc-800 rounded-lg shadow p-3 ${
                emphasize ? 'border-l-4 border-amber-500' : ''
            }`}
        >
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-1 tabular-nums">
                {value}
            </div>
        </div>
    );
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
}
