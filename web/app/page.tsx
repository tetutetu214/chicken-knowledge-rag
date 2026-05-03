'use client';

import { useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';

interface Citation {
    uri: string;
    page: number | null;
}

interface QAPair {
    question: string;
    answer: string;
    citations: Citation[];
    error?: boolean;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export default function Home() {
    const { user, signOut } = useAuthenticator((context) => [context.user]);
    const [question, setQuestion] = useState('');
    const [history, setHistory] = useState<QAPair[]>([]);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        const trimmed = question.trim();
        if (!trimmed || loading) return;
        if (!apiUrl) {
            setHistory((prev) => [
                ...prev,
                {
                    question: trimmed,
                    answer:
                        'NEXT_PUBLIC_API_URL が未設定です。'
                        + ' web/.env.local を作成して Lambda Function URL を指定してください。',
                    citations: [],
                    error: true,
                },
            ]);
            return;
        }

        setLoading(true);
        setQuestion('');

        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: trimmed }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || data.error || `HTTP ${res.status}`);
            }
            setHistory((prev) => [
                ...prev,
                {
                    question: trimmed,
                    answer: data.answer ?? '',
                    citations: data.citations ?? [],
                },
            ]);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setHistory((prev) => [
                ...prev,
                {
                    question: trimmed,
                    answer: `Error: ${message}`,
                    citations: [],
                    error: true,
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <main className="min-h-screen bg-zinc-50 dark:bg-zinc-900 px-4 py-6">
            <div className="max-w-3xl mx-auto">
                <header className="mb-8 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                            🐓 Chicken Knowledge RAG
                        </h1>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                            ペット鶏150羽との暮らしを支援するRAGエージェント (PoC・1スレッド限定)
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
                        <span>{user?.signInDetails?.loginId ?? user?.username}</span>
                        <button
                            onClick={signOut}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            サインアウト
                        </button>
                    </div>
                </header>

                <div className="space-y-4 mb-6">
                    {history.length === 0 && !loading && (
                        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-5 text-zinc-500 dark:text-zinc-400 text-sm">
                            養鶏に関する質問を下のフォームに入力してください。<br />
                            例: 「鳥インフルエンザの感染拡大防止のために最低限すべきことは？」
                        </div>
                    )}

                    {history.map((qa, i) => (
                        <article
                            key={i}
                            className="bg-white dark:bg-zinc-800 rounded-lg shadow p-5 space-y-3"
                        >
                            <div className="flex gap-3">
                                <div className="font-semibold text-blue-700 dark:text-blue-400 shrink-0">
                                    あなた:
                                </div>
                                <div className="flex-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                                    {qa.question}
                                </div>
                            </div>
                            <hr className="border-zinc-200 dark:border-zinc-700" />
                            <div className="flex gap-3">
                                <div
                                    className={`font-semibold shrink-0 ${
                                        qa.error
                                            ? 'text-red-700 dark:text-red-400'
                                            : 'text-green-700 dark:text-green-400'
                                    }`}
                                >
                                    回答:
                                </div>
                                <div className="flex-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                                    {qa.answer}
                                </div>
                            </div>
                            {qa.citations.length > 0 && (
                                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700">
                                    <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                                        引用元:
                                    </div>
                                    <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                                        {qa.citations.map((c, j) => {
                                            const filename = c.uri.split('/').pop() || c.uri;
                                            return (
                                                <li key={j}>
                                                    📄 {filename}
                                                    {c.page != null && ` (page ${c.page})`}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}
                        </article>
                    ))}

                    {loading && (
                        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-5 text-zinc-500 dark:text-zinc-400 text-sm animate-pulse">
                            🔍 KB検索 + Claude 4.5 が回答を生成中...
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 sticky bottom-4">
                    <textarea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="養鶏に関する質問を入力 (Cmd/Ctrl+Enter で送信)"
                        className="w-full border border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 rounded p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        disabled={loading}
                    />
                    <div className="flex justify-end mt-2">
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !question.trim()}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded text-sm transition-colors"
                        >
                            {loading ? '送信中...' : '送信 (⌘/Ctrl+Enter)'}
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
