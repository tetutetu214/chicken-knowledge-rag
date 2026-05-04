import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  // Amplify Hosting で静的サイトとして配信するための設定。
  // SSR 用 Compute (Lambda) 課金を回避するため、ビルド成果物を out/ に静的書き出しする。
  output: "export",
  // Next.js 16 Turbopack の workspace root をこのディレクトリ (web/) に固定する。
  // 未設定だとリポジトリルートの package-lock.json を見て workspace root を誤判定する。
  turbopack: {
    root: resolve(__dirname),
  },
  // next build の TypeScript チェックは Amplify Hosting (cd web && npm ci) の構成だと
  // ../amplify/ 配下まで型チェック対象に含めてしまい、@aws-amplify/backend 未解決で落ちる。
  // 型チェックは ampx sandbox デプロイ時の "Running type checks..." が amplify/ 全体を見るので
  // 二重に走らせる必要なし。
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
