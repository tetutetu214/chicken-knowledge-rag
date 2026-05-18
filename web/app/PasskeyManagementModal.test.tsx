import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PasskeyManagementModal from './PasskeyManagementModal';

vi.mock('aws-amplify/auth', () => ({
    listWebAuthnCredentials: vi.fn(async () => ({ credentials: [] })),
    associateWebAuthnCredential: vi.fn(async () => undefined),
    deleteWebAuthnCredential: vi.fn(async () => undefined),
}));

describe('PasskeyManagementModal', () => {
    it('open=false のとき何も表示しない', () => {
        const html = renderToStaticMarkup(
            <PasskeyManagementModal open={false} onClose={() => undefined} />,
        );

        expect(html).toBe('');
    });

    it('open=true のとき一覧コンテナを表示する', () => {
        const html = renderToStaticMarkup(
            <PasskeyManagementModal open={true} onClose={() => undefined} />,
        );

        expect(html).toContain('data-testid="passkey-list-container"');
        expect(html).toContain('登録済みパスキー');
    });

    it('open=true のとき登録ボタンと閉じるボタンを表示する', () => {
        const html = renderToStaticMarkup(
            <PasskeyManagementModal open={true} onClose={() => undefined} />,
        );

        expect(html).toContain('パスキーを登録');
        expect(html).toContain('aria-label="パスキー管理を閉じる"');
    });
});
