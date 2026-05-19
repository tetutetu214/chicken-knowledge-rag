'use client';

import { Amplify } from 'aws-amplify';
import { I18n } from 'aws-amplify/utils';
import { translations } from '@aws-amplify/ui-react';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

I18n.putVocabularies(translations);
I18n.setLanguage('ja');

I18n.putVocabulariesForLanguage('ja', {
    'Sign Out': 'サインアウト',
    'Hello': 'ようこそ',
    'Passkey': 'パスキー',
    'Add passkey': 'パスキーを追加',
    'WebAuthn is not supported on this device':
        'このデバイスはパスキーに対応していません',
});

export default function ConfigureAmplifyClientSide() {
    return null;
}
