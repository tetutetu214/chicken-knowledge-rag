/**
 * Amplify Hosting (静的サイト配信) を CDK で IaC 化する。
 *
 * 構成:
 * - Amplify::App: GitHub 連携 (oauthToken は Secrets Manager から取得)
 * - Amplify::Branch: 自動ビルド・自動デプロイ対象
 * - 環境変数: AMPLIFY_MONOREPO_APP_ROOT (web) / AMPLIFY_OUTPUTS_B64 (Sandbox 出力 base64)
 *
 * ビルド仕様 (amplify.yml) はリポジトリルートに配置済み。
 * CDK 側で buildSpec を上書きしないため、リポジトリ側の amplify.yml が優先される。
 *
 * Cognito Callback URL は OAuth フロー未使用 (Authenticator の username/password 認証) のため設定不要。
 */
import { Construct } from 'constructs';
import { SecretValue } from 'aws-cdk-lib';
import * as amplify from '@aws-cdk/aws-amplify-alpha';

export interface HostingProps {
    /** GitHub リポジトリのオーナー (例: tetutetu214) */
    githubOwner: string;
    /** GitHub リポジトリ名 (例: chicken-knowledge-rag) */
    githubRepo: string;
    /** PAT が保管されている Secrets Manager のシークレット名 (例: chicken-rag/github-token) */
    githubTokenSecretName: string;
    /** 自動デプロイ対象のブランチ名 (例: feature/amplify-hosting / main) */
    branchName: string;
    /**
     * Sandbox 環境の amplify_outputs.json を gzip + base64 化したもの。
     * Amplify Hosting の環境変数は 1 個 5500 文字上限のため、生 base64 (約15K文字) では収まらず gzip 圧縮で約 2.3K 文字に抑える。
     */
    amplifyOutputsGzB64: string;
}

export interface HostingResources {
    app: amplify.App;
    branch: amplify.Branch;
}

export const createHosting = (
    scope: Construct,
    props: HostingProps,
): HostingResources => {
    // Secrets Manager から GitHub PAT を遅延参照する
    // (CFn テンプレート上は Dynamic Reference として埋め込まれ、生の値は CDK 出力に残らない)
    const oauthToken = SecretValue.secretsManager(props.githubTokenSecretName);

    const app = new amplify.App(scope, 'ChickenRagHosting', {
        appName: 'chicken-knowledge-rag',
        sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
            owner: props.githubOwner,
            repository: props.githubRepo,
            oauthToken,
        }),
        environmentVariables: {
            // monorepo: web/ を Amplify Hosting の app root として認識させる
            AMPLIFY_MONOREPO_APP_ROOT: 'web',
            // amplify_outputs.json を gzip+base64 で受け渡し (preBuild で展開)
            AMPLIFY_OUTPUTS_GZ_B64: props.amplifyOutputsGzB64,
        },
        // 静的サイト配信 (Next.js output: 'export')。SSR Compute 課金を発生させない。
        platform: amplify.Platform.WEB,
    });

    const branch = app.addBranch(props.branchName, {
        autoBuild: true,
    });

    return { app, branch };
};
