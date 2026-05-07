'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// チャットメッセージの Markdown 描画。chat-handler の systemPrompt が
// `## 出典` などの構造化を出力するため、フロント側で見出し・太字・箇条書きを
// 解釈する必要がある。react-markdown はデフォルトで raw HTML を描画しない
// ため、ユーザー入力にも安全に適用できる。
const components: Components = {
    h1: ({ children }) => (
        <h1 className="text-lg font-bold mt-2 mb-1">{children}</h1>
    ),
    h2: ({ children }) => (
        <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>
    ),
    h3: ({ children }) => (
        <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>
    ),
    p: ({ children }) => (
        <p className="leading-relaxed mb-2 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
        <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
    ),
    li: ({ children }) => <li>{children}</li>,
    strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    a: ({ href, children }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline"
        >
            {children}
        </a>
    ),
    blockquote: ({ children }) => (
        <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-3 italic text-zinc-700 dark:text-zinc-300 my-2">
            {children}
        </blockquote>
    ),
    // インラインコードは className が undefined、ブロックコードは
    // `language-xxx` または同等の className が付く慣習に従って分岐する。
    code: ({ className, children }) => {
        if (!className) {
            return (
                <code className="bg-zinc-100 dark:bg-zinc-700 px-1 py-0.5 rounded text-sm font-mono">
                    {children}
                </code>
            );
        }
        return <code className={className}>{children}</code>;
    },
    pre: ({ children }) => (
        <pre className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-sm font-mono overflow-auto my-2">
            {children}
        </pre>
    ),
    hr: () => <hr className="border-zinc-200 dark:border-zinc-700 my-3" />,
    table: ({ children }) => (
        <table className="border-collapse my-2 text-sm">{children}</table>
    ),
    th: ({ children }) => (
        <th className="border border-zinc-300 dark:border-zinc-600 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 font-semibold text-left">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border border-zinc-300 dark:border-zinc-600 px-2 py-1">
            {children}
        </td>
    ),
};

export function MarkdownContent({ content }: { content: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
        </ReactMarkdown>
    );
}
