#!/usr/bin/env node
// web/amplify_outputs.json を gzip+base64 し、~/.secrets/chicken-knowledge-rag.env の
// AMPLIFY_OUTPUTS_GZ_B64 行を最新値で上書きするスクリプト。
//
// 背景: Amplify Hosting (本番) は AMPLIFY_OUTPUTS_GZ_B64 環境変数からビルド時に
// amplify_outputs.json を復元している (amplify.yml の preBuild フェーズ)。
// この env を更新しないと、sandbox を再デプロイしてスキーマが変わっても、本番ビルドは
// 古い amplify_outputs.json で固定されたままになる (2026-05-16 本番障害の根本原因)。
//
// 使い方:
//   `npm run sandbox` 内で自動実行される。手動で呼ぶ場合は:
//   `node scripts/sync-outputs-env.mjs`
//
// 同期後、次回の `npx ampx sandbox` 実行で Amplify Hosting App の環境変数が更新される。
// 即時に Hosting に反映したい場合は、続けて `npx ampx sandbox --once` を実行すること。

import {
    existsSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUTPUTS_PATH = 'web/amplify_outputs.json';
const ENV_PATH = join(
    homedir(),
    '.secrets',
    'chicken-knowledge-rag.env',
);
const ENV_VAR = 'AMPLIFY_OUTPUTS_GZ_B64';

const fail = (msg) => {
    console.error(`[sync-outputs-env] エラー: ${msg}`);
    process.exit(1);
};

if (!existsSync(OUTPUTS_PATH)) {
    fail(
        `${OUTPUTS_PATH} が見つかりません。`
            + ' 先に `npx ampx sandbox --once --outputs-out-dir web` を実行してください。',
    );
}

if (!existsSync(ENV_PATH)) {
    fail(`${ENV_PATH} が見つかりません。`);
}

const raw = readFileSync(OUTPUTS_PATH);
const gzB64 = gzipSync(raw).toString('base64');

const envContent = readFileSync(ENV_PATH, 'utf-8');
const lines = envContent.split('\n');
const existingIdx = lines.findIndex((l) =>
    l.startsWith(`export ${ENV_VAR}=`),
);
const newLine = `export ${ENV_VAR}=${gzB64}`;

let oldLen = 0;
if (existingIdx >= 0) {
    oldLen =
        lines[existingIdx].length - `export ${ENV_VAR}=`.length;
    lines[existingIdx] = newLine;
} else {
    lines.push(newLine);
}
const updated = lines.join('\n');

writeFileSync(ENV_PATH, updated, { mode: 0o600 });

const stat = statSync(ENV_PATH);
if ((stat.mode & 0o077) !== 0) {
    console.warn(
        `[sync-outputs-env] 警告: ${ENV_PATH} の権限が group/other で開きすぎています。`
            + ' chmod 600 を推奨します。',
    );
}

console.log(
    `[sync-outputs-env] ${ENV_VAR} を更新しました`
        + ` (length: ${oldLen} -> ${gzB64.length})`,
);
console.log(
    '[sync-outputs-env] 次回の `npx ampx sandbox` で Amplify Hosting App の'
        + ' 環境変数が更新されます。即時に本番に反映したい場合は続けて'
        + ' `source ~/.secrets/chicken-knowledge-rag.env && npx ampx sandbox --once --outputs-out-dir web` を実行してください。',
);
