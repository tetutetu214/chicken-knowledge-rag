'use client';

import { Amplify } from 'aws-amplify';
import { I18n } from 'aws-amplify/utils';
import { translations } from '@aws-amplify/ui-react';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

I18n.putVocabularies(translations);
I18n.setLanguage('ja');

I18n.putVocabulariesForLanguage('ja', {
    'Sign In': 'サインイン',
    'Sign in': 'サインイン',
    'Sign in to your account': 'アカウントにサインイン',
    'Email': 'メールアドレス',
    'Enter your Email': 'メールアドレスを入力',
    'Password': 'パスワード',
    'Enter your Password': 'パスワードを入力',
    'Forgot your password?': 'パスワードをお忘れですか？',
    'Reset Password': 'パスワードをリセット',
    'Send code': '確認コードを送信',
    'Back to Sign In': 'サインインに戻る',
    'Code': '確認コード',
    'Confirmation Code': '確認コード',
    'New Password': '新しいパスワード',
    'Submit': '送信',
    'Change Password': 'パスワードを変更',
    'Confirm Password': 'パスワード（確認）',
    'Please confirm your Password': 'パスワードを再入力してください',
    'Sign Out': 'サインアウト',
    'Hello': 'ようこそ',
    'Sign In with Password': 'パスワードでサインイン',
    'Sign In with Passkey': 'パスキーでサインイン',
    'Passkey': 'パスキー',
    'Add passkey': 'パスキーを追加',
    'WebAuthn is not supported on this device':
        'このデバイスはパスキーに対応していません',
});

export default function ConfigureAmplifyClientSide() {
    return null;
}
