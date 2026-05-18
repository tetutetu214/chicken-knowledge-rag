'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    associateWebAuthnCredential,
    deleteWebAuthnCredential,
    listWebAuthnCredentials,
    type AuthWebAuthnCredential,
} from 'aws-amplify/auth';

interface PasskeyManagementModalProps {
    open: boolean;
    onClose: () => void;
}

function isUserCancelledException(error: unknown): boolean {
    return error instanceof Error && error.name === 'UserCancelledException';
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

function formatCreatedAt(createdAt: Date | undefined): string {
    if (!createdAt) return '作成日時不明';
    return createdAt.toLocaleString('ja-JP');
}

export default function PasskeyManagementModal({
    open,
    onClose,
}: PasskeyManagementModalProps) {
    const [credentials, setCredentials] = useState<AuthWebAuthnCredential[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleError = useCallback((label: string, error: unknown) => {
        if (isUserCancelledException(error)) {
            console.log(`[${label}] UserCancelledException`, error);
            return;
        }
        console.error(`[${label}]`, error);
        setErrorMessage(`${label}: ${toErrorMessage(error)}`);
    }, []);

    const loadCredentials = useCallback(async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            const result = await listWebAuthnCredentials();
            setCredentials(result.credentials);
        } catch (error) {
            handleError('パスキー一覧取得失敗', error);
        } finally {
            setLoading(false);
        }
    }, [handleError]);

    useEffect(() => {
        if (open) {
            void loadCredentials();
        }
    }, [loadCredentials, open]);

    if (!open) return null;

    const registerPasskey = async () => {
        setActionLoading('register');
        setErrorMessage(null);
        try {
            await associateWebAuthnCredential();
            await loadCredentials();
        } catch (error) {
            handleError('パスキー登録失敗', error);
        } finally {
            setActionLoading(null);
        }
    };

    const deletePasskey = async (credentialId: string) => {
        setActionLoading(credentialId);
        setErrorMessage(null);
        try {
            await deleteWebAuthnCredential({ credentialId });
            await loadCredentials();
        } catch (error) {
            handleError('パスキー削除失敗', error);
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <div
            className={[
                'fixed inset-0 z-50 flex items-center justify-center',
                'bg-black/50 px-4',
            ].join(' ')}
            role="dialog"
            aria-modal="true"
            aria-labelledby="passkey-management-title"
        >
            <div
                className={[
                    'w-full max-w-lg rounded-lg bg-white shadow-xl',
                    'dark:bg-zinc-800',
                ].join(' ')}
            >
                <div
                    className={[
                        'flex items-center justify-between border-b',
                        'border-zinc-200 p-4 dark:border-zinc-700',
                    ].join(' ')}
                >
                    <div>
                        <h2
                            id="passkey-management-title"
                            className={[
                                'text-base font-bold text-zinc-900',
                                'dark:text-zinc-50',
                            ].join(' ')}
                        >
                            パスキー管理
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            このアカウントで使うパスキーを登録・削除します
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={[
                            'min-h-11 min-w-11 rounded text-xl text-zinc-500',
                            'hover:bg-zinc-100 hover:text-zinc-900',
                            'dark:text-zinc-400 dark:hover:bg-zinc-700',
                            'dark:hover:text-zinc-50',
                        ].join(' ')}
                        aria-label="パスキー管理を閉じる"
                    >
                        ✕
                    </button>
                </div>

                <div className="space-y-4 p-4">
                    {errorMessage && (
                        <div
                            className={[
                                'rounded border border-red-200 bg-red-50 p-3',
                                'text-sm text-red-700 dark:border-red-800',
                                'dark:bg-red-900/30 dark:text-red-300',
                            ].join(' ')}
                        >
                            {errorMessage}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => void registerPasskey()}
                        disabled={actionLoading !== null || loading}
                        className={[
                            'w-full rounded bg-blue-600 px-4 py-2 text-sm',
                            'font-semibold text-white hover:bg-blue-700',
                            'disabled:cursor-not-allowed disabled:bg-zinc-400',
                        ].join(' ')}
                    >
                        {actionLoading === 'register'
                            ? '登録中...'
                            : 'パスキーを登録'}
                    </button>

                    <div
                        className="rounded border border-zinc-200 dark:border-zinc-700"
                        data-testid="passkey-list-container"
                    >
                        <div
                            className={[
                                'border-b border-zinc-200 px-3 py-2 text-sm',
                                'font-semibold text-zinc-700',
                                'dark:border-zinc-700 dark:text-zinc-200',
                            ].join(' ')}
                        >
                            登録済みパスキー
                        </div>
                        {loading ? (
                            <p className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
                                読み込み中...
                            </p>
                        ) : credentials.length === 0 ? (
                            <p className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
                                登録済みのパスキーはありません
                            </p>
                        ) : (
                            <ul
                                className={[
                                    'divide-y divide-zinc-200',
                                    'dark:divide-zinc-700',
                                ].join(' ')}
                            >
                                {credentials.map((credential) => {
                                    const credentialId = credential.credentialId;
                                    return (
                                        <li
                                            key={credentialId}
                                            className="flex items-center gap-3 p-3"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div
                                                    className={[
                                                        'truncate text-sm font-medium',
                                                        'text-zinc-900',
                                                        'dark:text-zinc-100',
                                                    ].join(' ')}
                                                >
                                                    {credential.friendlyCredentialName
                                                        ?? '名称未設定のパスキー'}
                                                </div>
                                                <div
                                                    className={[
                                                        'mt-1 text-xs text-zinc-500',
                                                        'dark:text-zinc-400',
                                                    ].join(' ')}
                                                >
                                                    {formatCreatedAt(
                                                        credential.createdAt,
                                                    )}
                                                </div>
                                                {credentialId && (
                                                    <div
                                                        className={[
                                                            'mt-1 truncate font-mono',
                                                            'text-[10px] text-zinc-400',
                                                            'dark:text-zinc-500',
                                                        ].join(' ')}
                                                    >
                                                        {credentialId}
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (credentialId) {
                                                        void deletePasskey(
                                                            credentialId,
                                                        );
                                                    }
                                                }}
                                                disabled={
                                                    !credentialId
                                                    || actionLoading !== null
                                                    || loading
                                                }
                                                className={[
                                                    'min-h-11 rounded border',
                                                    'border-red-200 px-3 text-sm',
                                                    'font-medium text-red-600',
                                                    'hover:bg-red-50',
                                                    'disabled:cursor-not-allowed',
                                                    'disabled:border-zinc-200',
                                                    'disabled:text-zinc-400',
                                                    'dark:border-red-900',
                                                    'dark:text-red-300',
                                                    'dark:hover:bg-red-900/30',
                                                    'dark:disabled:border-zinc-700',
                                                    'dark:disabled:text-zinc-500',
                                                ].join(' ')}
                                            >
                                                {actionLoading === credentialId
                                                    ? '削除中...'
                                                    : '削除'}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
