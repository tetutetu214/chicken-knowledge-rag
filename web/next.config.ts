import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  // Amplify Hosting で静的サイトとして配信するための設定。
  // SSR 用 Compute (Lambda) 課金を回避するため、ビルド成果物を out/ に静的書き出しする。
  output: "export",
  // Next.js 16 Turbopack の workspace root をこのディレクトリ (web/) に固定する。
  // 未設定だとリポジトリルートの package-lock.json を見て workspace root を誤判定し、
  // ../amplify/ 配下まで TypeScript チェック範囲が広がって @aws-amplify/backend 解決失敗で落ちる。
  turbopack: {
    root: resolve(__dirname),
  },
};

export default nextConfig;
