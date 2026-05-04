import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting で静的サイトとして配信するための設定。
  // SSR 用 Compute (Lambda) 課金を回避するため、ビルド成果物を out/ に静的書き出しする。
  output: "export",
};

export default nextConfig;
