import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Linux deployment builds a self-contained server. Windows local builds
  // keep the normal output because pnpm's traced symlinks require privileges.
  output: process.env.DEPLOY_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
