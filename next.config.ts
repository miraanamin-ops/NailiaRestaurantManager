import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // No Next.js toolbar badge on local pages (it covered the chat's typing box in screenshots).
  devIndicators: false,
  partialPrefetching: true,
  // The agent prompts in /agents are read from disk at runtime (lib/agents/loader.ts),
  // so every server function carries a copy.
  outputFileTracingIncludes: {
    "/**": ["./agents/*.md", "./agents/*.config.json"],
  },
  experimental: {
    // Menu photos are uploaded one at a time, shrunk in the browser first (well under this).
    serverActions: { bodySizeLimit: "3mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
