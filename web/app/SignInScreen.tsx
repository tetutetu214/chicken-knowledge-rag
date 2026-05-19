'use client';

import { type FormEvent, useState } from 'react';
import { signIn } from 'aws-amplify/auth';

type SignInExecutor = typeof signIn;

interface SignInScreenProps {
    defaultShowPasswordForm?: boolean;
}

const EMAIL_REQUIRED_MESSAGE = 'メールアドレスを入力してください';
const PASSKEY_UNSUPPORTED_MESSAGE =
    'お使いの端末はパスキー非対応のようです。'
    + '下の「パスワードでサインイン」をお使いください';

const WEBAUTHN_UNSUPPORTED_ERROR_NAMES = new Set([
    'InvalidStateError',
    'NotSupportedError',
    'NotAllowedError',
]);

export function isUserCancelledException(error: unknown): boolean {
    return error instanceof Error && error.name === 'UserCancelledException';
}

export function isWebAuthnUnsupportedError(error: unknown): boolean {
    return (
        error instanceof Error
        && WEBAUTHN_UNSUPPORTED_ERROR_NAMES.has(error.name)
    );
}

export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

export async function signInWithPasskey(
    username: string,
    signInExecutor: SignInExecutor = signIn,
) {
    return signInExecutor({
        username,
        options: {
            authFlowType: 'USER_AUTH',
            preferredChallenge: 'WEB_AUTHN',
        },
    });
}

export async function signInWithPassword(
    username: string,
    password: string,
    signInExecutor: SignInExecutor = signIn,
) {
    // USER_AUTH フローでパスワード認証する場合は preferredChallenge を
    // 明示しないと Cognito が CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION を
    // 返してきて 1 回の signIn で完了しない。PASSWORD_SRP は SRP プロトコル
    // (パスワードがサーバに届かない) で aws-amplify v6 の推奨デフォルト。
    return signInExecutor({
        username,
        password,
        options: {
            authFlowType: 'USER_AUTH',
            preferredChallenge: 'PASSWORD_SRP',
        },
    });
}

export default function SignInScreen({
    defaultShowPasswordForm = false,
}: SignInScreenProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPasswordForm, setShowPasswordForm] = useState(
        defaultShowPasswordForm,
    );
    const [loading, setLoading] = useState<'passkey' | 'password' | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const validateEmail = (): string | null => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            setErrorMessage(EMAIL_REQUIRED_MESSAGE);
            return null;
        }
        return trimmedEmail;
    };

    const handleSignInResult = (signInStep: string) => {
        if (signInStep !== 'DONE') {
            setErrorMessage(
                'サインインを完了できませんでした。'
                + 'パスワードでサインインをお試しください',
            );
        }
    };

    const handlePasskeySignIn = async () => {
        const username = validateEmail();
        if (!username) return;

        setLoading('passkey');
        setErrorMessage(null);
        try {
            const result = await signInWithPasskey(username);
            handleSignInResult(result.nextStep.signInStep);
        } catch (error: unknown) {
            if (isUserCancelledException(error)) {
                return;
            }
            if (isWebAuthnUnsupportedError(error)) {
                setErrorMessage(PASSKEY_UNSUPPORTED_MESSAGE);
                return;
            }
            setErrorMessage(toErrorMessage(error));
        } finally {
            setLoading(null);
        }
    };

    const handlePasswordSignIn = async (event: FormEvent) => {
        event.preventDefault();
        const username = validateEmail();
        if (!username) return;

        setLoading('password');
        setErrorMessage(null);
        try {
            const result = await signInWithPassword(username, password);
            handleSignInResult(result.nextStep.signInStep);
        } catch (error: unknown) {
            setErrorMessage(toErrorMessage(error));
        } finally {
            setLoading(null);
        }
    };

    return (
        <main
            className={[
                'flex min-h-screen items-center justify-center bg-zinc-50',
                'px-4 py-8 dark:bg-zinc-900',
            ].join(' ')}
        >
            <section
                className={[
                    'w-full max-w-md rounded-lg border border-zinc-200',
                    'bg-white p-6 shadow-sm dark:border-zinc-700',
                    'dark:bg-zinc-800',
                ].join(' ')}
                aria-labelledby="sign-in-title"
            >
                <div className="mb-6">
                    <h1
                        id="sign-in-title"
                        className="text-xl font-bold text-zinc-900 dark:text-zinc-50"
                    >
                        Cocco RAG
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        メールアドレスで本人確認を開始します
                    </p>
                </div>

                {errorMessage && (
                    <div
                        className={[
                            'mb-4 rounded border border-red-200 bg-red-50',
                            'p-3 text-sm text-red-700 dark:border-red-800',
                            'dark:bg-red-900/30 dark:text-red-300',
                        ].join(' ')}
                        role="alert"
                    >
                        {errorMessage}
                    </div>
                )}

                <div className="space-y-4">
                    <label className="block">
                        <span
                            className={[
                                'text-sm font-medium text-zinc-700',
                                'dark:text-zinc-200',
                            ].join(' ')}
                        >
                            メールアドレス
                        </span>
                        <input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="username webauthn"
                            className={[
                                'mt-1 min-h-11 w-full rounded border',
                                'border-zinc-300 bg-white px-3 text-base',
                                'text-zinc-900 outline-none',
                                'focus:border-blue-500 focus:ring-2',
                                'focus:ring-blue-500/20 dark:border-zinc-600',
                                'dark:bg-zinc-900 dark:text-zinc-50',
                            ].join(' ')}
                            aria-label="メールアドレス"
                        />
                    </label>

                    <button
                        type="button"
                        onClick={() => void handlePasskeySignIn()}
                        disabled={loading !== null}
                        className={[
                            'min-h-11 w-full rounded bg-blue-600 px-4',
                            'text-sm font-semibold text-white',
                            'hover:bg-blue-700 disabled:cursor-not-allowed',
                            'disabled:bg-zinc-400',
                        ].join(' ')}
                        aria-label="パスキーでサインイン"
                    >
                        {loading === 'passkey'
                            ? 'サインイン中...'
                            : '🔑 パスキーでサインイン'}
                    </button>

                    {showPasswordForm ? (
                        <form
                            id="password-sign-in"
                            className="space-y-4"
                            onSubmit={(event) => void handlePasswordSignIn(event)}
                        >
                            <label className="block">
                                <span
                                    className={[
                                        'text-sm font-medium text-zinc-700',
                                        'dark:text-zinc-200',
                                    ].join(' ')}
                                >
                                    パスワード
                                </span>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                    autoComplete="current-password"
                                    className={[
                                        'mt-1 min-h-11 w-full rounded border',
                                        'border-zinc-300 bg-white px-3',
                                        'text-base text-zinc-900 outline-none',
                                        'focus:border-blue-500 focus:ring-2',
                                        'focus:ring-blue-500/20',
                                        'dark:border-zinc-600',
                                        'dark:bg-zinc-900 dark:text-zinc-50',
                                    ].join(' ')}
                                    aria-label="パスワード"
                                />
                            </label>
                            <button
                                type="submit"
                                disabled={loading !== null}
                                className={[
                                    'min-h-11 w-full rounded border',
                                    'border-zinc-300 px-4 text-sm',
                                    'font-semibold text-zinc-800',
                                    'hover:bg-zinc-50',
                                    'disabled:cursor-not-allowed',
                                    'disabled:text-zinc-400',
                                    'dark:border-zinc-600 dark:text-zinc-100',
                                    'dark:hover:bg-zinc-700',
                                ].join(' ')}
                                aria-label="パスワードでサインイン"
                            >
                                {loading === 'password'
                                    ? 'サインイン中...'
                                    : 'パスワードでサインイン'}
                            </button>
                        </form>
                    ) : (
                        <a
                            href="#password-sign-in"
                            onClick={(event) => {
                                event.preventDefault();
                                setErrorMessage(null);
                                setShowPasswordForm(true);
                            }}
                            className={[
                                'block min-h-11 rounded px-3 py-3 text-center',
                                'text-sm font-medium text-blue-600',
                                'hover:underline dark:text-blue-400',
                            ].join(' ')}
                            aria-label="パスワードでサインイン"
                        >
                            パスワードでサインイン
                        </a>
                    )}
                </div>
            </section>
        </main>
    );
}
