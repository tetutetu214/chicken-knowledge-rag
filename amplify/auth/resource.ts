import { defineAuth } from '@aws-amplify/backend';

const PASSKEY_RPID = process.env.PASSKEY_RPID;
if (!PASSKEY_RPID) {
  throw new Error(
    'PASSKEY_RPID 未設定: `source ~/.secrets/chicken-knowledge-rag.env` を実行してください',
  );
}

export const auth = defineAuth({
  loginWith: {
    email: true,
    webAuthn: {
      relyingPartyId: PASSKEY_RPID,
      userVerification: 'required',
    },
  },
});
