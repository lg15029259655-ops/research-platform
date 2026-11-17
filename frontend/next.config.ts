import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Parallel local previews need separate build caches.
  distDir: process.env.MEDREAD_NEXT_DIST || (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8001" ? ".next-preview" : ".next"),
  // Linux deployment builds a self-contained server. Windows local builds
  // keep the normal output because pnpm's traced symlinks require privileges.
  output: process.env.DEPLOY_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
