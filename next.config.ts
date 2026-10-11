import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The agent prompts in /agents are read from disk at runtime (lib/agents/loader.ts),
  // so every server function carries a copy.
  outputFileTracingIncludes: {
    "/**": ["./agents/*.md"],
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
