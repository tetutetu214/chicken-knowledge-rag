'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { MarkdownContent } from './MarkdownContent';

const client = generateClient<Schema>();

// LLM に渡す履歴件数の上限。これを超えた古い履歴は summary に統合する。
const HISTORY_LIMIT = 10;
// DynamoDB TTL: 90日後の Unix epoch seconds を返す。
const TTL_DAYS = 90;
const ttlSeconds = (): number =>
    Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;

interface Citation {
    uri: string;
    page: number | null;
}

interface MessageRow {
    id: string;
    role: string;
    content: string;
    citations: Citation[];
    hasKbResults: boolean;
    // KB Retrieve 最大コサイン類似度 (assistant メッセージのみ)。Issue #16 Phase 1。
    topScore: number | null;
    createdAt: string;
}

interface ThreadRow {
    id: string;
    title: string;
    summary: string;
    summarizedCount: number;
    updatedAt: string;
}

// a.json() フィールドは Amplify が JSON.parse 済みで返すが、保存形態によっては
// string で返るケースもあるため両対応のパース関数。
const parseCitations = (raw: unknown): Citation[] => {
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

export default function Home() {
    const { user, signOut } = useAuthenticator((context) => [context.user]);
    const [threads, setThreads] = useState<ThreadRow[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<MessageRow[]>([]);
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // スマホ用: 左ペイン (サイドバー) の表示・非表示。PC (md以上) では常に表示。
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const showError = (label: string, e: unknown) => {
        const m = e instanceof Error ? e.message : String(e);
        console.error(`[${label}]`, e);
        setError(`${label}: ${m}`);
    };

    const loadThreads = useCallback(async () => {
        try {
            const { data, errors } = await client.models.Conversation.list({
                limit: 100,
            });
            if (errors && errors.length > 0) {
                throw new Error(
                    errors.map((er) => er.message).join(' / '),
                );
            }
            const rows: ThreadRow[] = (data ?? [])
                .map((d) => ({
                    id: d.id,
                    title: d.title,
                    summary: d.summary ?? '',
                    summarizedCount: d.summarizedCount ?? 0,
                    updatedAt: d.updatedAt,
                }))
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            setThreads(rows);
            setError(null);
        } catch (e) {
            showError('スレッド一覧取得失敗', e);
        }
    }, []);

    const loadMessages = useCallback(async (convId: string) => {
        try {
            const { data, errors } = await client.models.Message.list({
                filter: { conversationId: { eq: convId } },
                limit: 1000,
            });
            if (errors && errors.length > 0) {
                throw new Error(
                    errors.map((er) => er.message).join(' / '),
                );
            }
            const rows: MessageRow[] = (data ?? [])
                .map((d) => ({
                    id: d.id,
                    role: d.role,
                    content: d.content,
                    citations: parseCitations(d.citations),
                    hasKbResults: d.hasKbResults ?? false,
                    topScore: d.topScore ?? null,
                    createdAt: d.createdAt,
                }))
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            setMessages(rows);
        } catch (e) {
            showError('メッセージ取得失敗', e);
        }
    }, []);

    useEffect(() => {
        void loadThreads();
    }, [loadThreads]);

    useEffect(() => {
        if (activeId) {
            void loadMessages(activeId);
        } else {
            setMessages([]);
        }
    }, [activeId, loadMessages]);

    // 新メッセージ追加時に末尾へスクロール
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const createThread = async () => {
        try {
            const { data, errors } = await client.models.Conversation.create({
                title: '新しい会話',
                summarizedCount: 0,
                expiresAt: ttlSeconds(),
            });
            if (errors && errors.length > 0) {
                throw new Error(
                    errors.map((er) => er.message).join(' / '),
                );
            }
            if (!data) return;
            await loadThreads();
            setActiveId(data.id);
            setError(null);
        } catch (e) {
            showError('スレッド作成失敗', e);
        }
    };

    const deleteThread = async (id: string) => {
        if (!window.confirm('このスレッドを削除しますか?')) return;
        try {
            // Amplify Data はリレーションの cascading delete をサポートしないため、
            // 紐付く Message を全件取得 → 個別削除 → Conversation 削除の順で行う。
            const { data: msgs } = await client.models.Message.list({
                filter: { conversationId: { eq: id } },
                limit: 1000,
            });
            await Promise.all(
                (msgs ?? []).map((m) =>
                    client.models.Message.delete({ id: m.id }),
                ),
            );
            await client.models.Conversation.delete({ id });
            if (activeId === id) setActiveId(null);
            await loadThreads();
            setError(null);
        } catch (e) {
            showError('スレッド削除失敗', e);
        }
    };

    const maybeSummarize = async (
        convId: string,
        existingSummary: string,
        summarizedCount: number,
    ) => {
        // 最新メッセージを再取得 (送信直後の state では未反映分があるため)
        const { data: all } = await client.models.Message.list({
            filter: { conversationId: { eq: convId } },
            limit: 1000,
        });
        const sorted = (all ?? []).sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
        );
        const total = sorted.length;
        // summary 化されていない件数 = total - summarizedCount
        // 直近 HISTORY_LIMIT 件は LLM に直接渡すため summary 対象外
        const unsummarized = total - summarizedCount;
        if (unsummarized <= HISTORY_LIMIT) return;

        // 新たに summary に取り込む範囲: [summarizedCount, total - HISTORY_LIMIT)
        const targetEnd = total - HISTORY_LIMIT;
        const target = sorted
            .slice(summarizedCount, targetEnd)
            .map((m) => ({ role: m.role, content: m.content }));

        const { data: summaryResp, errors } = await client.mutations.summarize({
            existingSummary,
            messagesJson: JSON.stringify(target),
        });
        if (errors && errors.length > 0) {
            console.error('summarize failed:', errors);
            return;
        }
        if (!summaryResp) return;

        await client.models.Conversation.update({
            id: convId,
            summary: summaryResp.summary,
            summarizedCount: targetEnd,
        });
        await loadThreads();
    };

    const send = async () => {
        const text = question.trim();
        if (!text || loading) return;

        setLoading(true);
        setError(null);
        setQuestion('');

        try {
            let convId = activeId;
            let convSummary = '';
            let convSummarizedCount = 0;
            let isFirstMessage = false;

            if (!convId) {
                // スレッド未選択時は新規作成し、タイトルは質問の冒頭40文字
                const { data: created, errors: createErrs } =
                    await client.models.Conversation.create({
                        title: text.slice(0, 40),
                        summarizedCount: 0,
                        expiresAt: ttlSeconds(),
                    });
                if (createErrs && createErrs.length > 0) {
                    throw new Error(
                        createErrs.map((er) => er.message).join(' / '),
                    );
                }
                if (!created) {
                    throw new Error('Conversation.create が data を返さなかった');
                }
                convId = created.id;
                isFirstMessage = true;
                await loadThreads();
                setActiveId(convId);
            } else {
                const t = threads.find((tr) => tr.id === convId);
                if (t) {
                    convSummary = t.summary;
                    convSummarizedCount = t.summarizedCount;
                }
                if (messages.length === 0) {
                    isFirstMessage = true;
                }
            }

            if (isFirstMessage && convId) {
                await client.models.Conversation.update({
                    id: convId,
                    title: text.slice(0, 40),
                });
            }

            // 直近 HISTORY_LIMIT 件を Lambda へ渡す
            const recent = messages.slice(-HISTORY_LIMIT);
            const historyJson = JSON.stringify(
                recent.map((m) => ({ role: m.role, content: m.content })),
            );

            // user メッセージ保存
            const { errors: userMsgErrs } =
                await client.models.Message.create({
                    conversationId: convId,
                    role: 'user',
                    content: text,
                    hasKbResults: false,
                    expiresAt: ttlSeconds(),
                });
            if (userMsgErrs && userMsgErrs.length > 0) {
                throw new Error(
                    'user メッセージ保存失敗: '
                    + userMsgErrs.map((er) => er.message).join(' / '),
                );
            }

            const { data: resp, errors } = await client.queries.chat({
                question: text,
                historyJson,
                summary: convSummary,
            });
            if (errors && errors.length > 0) {
                throw new Error(errors[0].message ?? 'GraphQL error');
            }
            if (!resp) {
                throw new Error('No response');
            }

            // citations は AppSync の AWSJSON が JSON 文字列を期待するため stringify。
            // 取得側 (parseCitations) は string / object 両対応で実装済み。
            const citationsForSave = JSON.stringify(
                (resp.citations ?? []).filter(
                    (c): c is NonNullable<typeof c> => c !== null,
                ),
            );

            // assistant メッセージ保存
            const { errors: asstMsgErrs } =
                await client.models.Message.create({
                    conversationId: convId,
                    role: 'assistant',
                    content: resp.answer ?? '',
                    citations: citationsForSave,
                    hasKbResults: resp.hasKbResults ?? false,
                    topScore: resp.topScore ?? null,
                    expiresAt: ttlSeconds(),
                });
            if (asstMsgErrs && asstMsgErrs.length > 0) {
                throw new Error(
                    'assistant メッセージ保存失敗: '
                    + asstMsgErrs.map((er) => er.message).join(' / '),
                );
            }

            await loadMessages(convId);
            // バックグラウンドで要約発動チェック (await しない、UI ブロックしない)
            void maybeSummarize(convId, convSummary, convSummarizedCount);
        } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            setError(m);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
        }
    };

    return (
        <main className="min-h-screen bg-zinc-50 dark:bg-zinc-900 flex">
            {/* スマホ用: ハンバーガーメニューボタン (md未満で表示) */}
            <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="md:hidden fixed top-3 left-3 z-40 p-2 bg-white dark:bg-zinc-800 rounded-md shadow border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                aria-label="メニューを開く"
            >
                ☰
            </button>
            {/* スマホ用: サイドバー展開時の背景オーバーレイ。タップで閉じる */}
            {sidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 z-30 bg-black/50"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}
            <aside
                className={`w-72 shrink-0 flex flex-col h-screen bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 fixed inset-y-0 left-0 z-40 md:sticky md:top-0 md:z-auto transition-transform ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
                }`}
            >
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                        🐓 Cocco RAG
                    </h1>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        にわとり飼育アシスタント　コケ先輩
                    </p>
                </div>
                <button
                    onClick={() => {
                        void createThread();
                        setSidebarOpen(false);
                    }}
                    className="m-3 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold"
                >
                    + 新しい会話
                </button>
                <div className="flex-1 overflow-y-auto px-2">
                    {threads.length === 0 && (
                        <p className="px-2 text-xs text-zinc-500 dark:text-zinc-400">
                            まだスレッドがありません
                        </p>
                    )}
                    {threads.map((t) => (
                        <div
                            key={t.id}
                            className={`group flex items-center justify-between gap-1 px-2 py-2 rounded cursor-pointer ${
                                activeId === t.id
                                    ? 'bg-zinc-200 dark:bg-zinc-800'
                                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                            onClick={() => {
                                setActiveId(t.id);
                                setSidebarOpen(false);
                            }}
                        >
                            <span className="text-sm text-zinc-800 dark:text-zinc-200 truncate flex-1">
                                {t.title}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteThread(t.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-700 px-1"
                                title="削除"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                    <div className="truncate mb-1">
                        {user?.signInDetails?.loginId ?? user?.username}
                    </div>
                    <button
                        onClick={signOut}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        サインアウト
                    </button>
                </div>
            </aside>

            <section className="flex-1 flex flex-col min-h-screen">
                <div className="flex-1 overflow-y-auto px-4 pt-14 md:pt-6 pb-6">
                    <div className="max-w-3xl mx-auto space-y-4">
                        {!activeId && (
                            <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 text-zinc-600 dark:text-zinc-400 text-sm">
                                左の「+ 新しい会話」を押してスレッドを開始してください。<br />
                                既存スレッドを選ぶと、過去の会話履歴を引き継いで質問できます。
                            </div>
                        )}
                        {activeId && messages.length === 0 && !loading && (
                            <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 text-zinc-500 dark:text-zinc-400 text-sm">
                                鶏に関する質問を下のフォームに入力してください。
                            </div>
                        )}
                        {messages.map((m) => (
                            <article
                                key={m.id}
                                className="bg-white dark:bg-zinc-800 rounded-lg shadow p-5"
                            >
                                {m.role === 'user' ? (
                                    <div className="flex flex-col gap-1">
                                        <div className="font-semibold text-blue-700 dark:text-blue-400">
                                            あなた:
                                        </div>
                                        <div className="flex-1 text-zinc-900 dark:text-zinc-100">
                                            <MarkdownContent content={m.content} />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-1">
                                            <div
                                                className={`font-semibold ${
                                                    m.hasKbResults
                                                        ? 'text-green-700 dark:text-green-400'
                                                        : 'text-amber-700 dark:text-amber-400'
                                                }`}
                                            >
                                                {m.hasKbResults
                                                    ? '回答 (KB根拠あり):'
                                                    : '回答 (KB根拠なし):'}
                                            </div>
                                            <div className="flex-1 text-zinc-800 dark:text-zinc-200">
                                                <MarkdownContent content={m.content} />
                                            </div>
                                        </div>
                                        {m.citations.length > 0 && (
                                            <div className="pt-2 mt-3 border-t border-zinc-100 dark:border-zinc-700">
                                                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                                                    引用元:
                                                </div>
                                                <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                                                    {m.citations.map((c, i) => {
                                                        const filename =
                                                            c.uri.split('/').pop() || c.uri;
                                                        return (
                                                            <li key={i}>
                                                                📄 {filename}
                                                                {c.page != null
                                                                    && ` (page ${c.page})`}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                    </>
                                )}
                            </article>
                        ))}
                        {loading && (
                            <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-5 text-zinc-500 dark:text-zinc-400 text-sm animate-pulse">
                                🔍 KB検索 + Claude が回答を生成中...
                            </div>
                        )}
                        {error && (
                            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
                                Error: {error}
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>
                <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
                    <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-800 rounded-lg shadow p-3">
                        <textarea
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="鶏に関する質問を入力 (Cmd/Ctrl+Enter で送信)"
                            className="w-full border border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 rounded p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={3}
                            disabled={loading}
                        />
                        <div className="flex justify-end mt-2">
                            <button
                                onClick={() => void send()}
                                disabled={loading || !question.trim()}
                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded text-sm transition-colors"
                            >
                                {loading ? '送信中...' : '送信 (⌘/Ctrl+Enter)'}
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
