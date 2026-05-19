import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from 'aws-amplify/auth';
import SignInScreen, {
    signInWithPasskey,
    signInWithPassword,
} from './SignInScreen';

vi.mock('aws-amplify/auth', () => ({
    signIn: vi.fn(async () => ({
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
    })),
}));

const mockedSignIn = vi.mocked(signIn);

describe('SignInScreen', () => {
    beforeEach(() => {
        mockedSignIn.mockClear();
    });

    it('初期表示でパスキーボタンを表示し、パスキー用の signIn 引数を組み立てる', async () => {
        const html = renderToStaticMarkup(<SignInScreen />);

        expect(html).toContain('🔑 パスキーでサインイン');
        expect(html).toContain('aria-label="メールアドレス"');

        await signInWithPasskey('user@example.com');

        expect(mockedSignIn).toHaveBeenCalledWith({
            username: 'user@example.com',
            options: {
                authFlowType: 'USER_AUTH',
                preferredChallenge: 'WEB_AUTHN',
            },
        });
    });

    it('パスワード fallback を開くとパスワード入力欄が現れる', () => {
        const html = renderToStaticMarkup(<SignInScreen />);
        const expandedHtml = renderToStaticMarkup(
            <SignInScreen defaultShowPasswordForm={true} />,
        );

        expect(html).toContain('href="#password-sign-in"');
        expect(html).not.toContain('aria-label="パスワード"');
        expect(expandedHtml).toContain('aria-label="パスワード"');
        expect(expandedHtml).toContain('type="password"');
    });

    it('パスワード送信時は preferredChallenge: PASSWORD_SRP で signIn を呼ぶ', async () => {
        // USER_AUTH フローでパスワード認証する場合 preferredChallenge を
        // 明示しないと Cognito が第1認証要素の選択ステップを返してきて
        // 1 回の signIn で完了しない。PASSWORD_SRP を明示することで
        // 直接 DONE に到達する。
        await signInWithPassword('user@example.com', 'password-123');

        expect(mockedSignIn).toHaveBeenCalledWith({
            username: 'user@example.com',
            password: 'password-123',
            options: {
                authFlowType: 'USER_AUTH',
                preferredChallenge: 'PASSWORD_SRP',
            },
        });
    });
});
