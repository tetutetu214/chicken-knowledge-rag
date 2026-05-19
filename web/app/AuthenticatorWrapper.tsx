'use client';

import type { ReactNode } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import SignInScreen from './SignInScreen';

export default function AuthenticatorWrapper({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <Authenticator.Provider>
            <AuthenticatorRoute>{children}</AuthenticatorRoute>
        </Authenticator.Provider>
    );
}

function AuthenticatorRoute({ children }: { children: ReactNode }) {
    // route は Authenticator UI が描画されていないと更新されないため、
    // Hub auth イベントに反応して動く authStatus を使う。
    // (`configuring` 初期 → `unauthenticated` → `authenticated` の流れ)
    const { authStatus } = useAuthenticator((context) => [context.authStatus]);

    if (authStatus === 'authenticated') {
        return <>{children}</>;
    }

    return <SignInScreen />;
}
