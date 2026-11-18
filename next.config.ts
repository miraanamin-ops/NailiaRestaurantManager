import type { NextConfig } from "next";

// Browser safety headers on every page and API answer (security review S2).
// frame-ancestors / X-Frame-Options: no other site can show our pages inside its
// own (so nobody can trick an owner into tapping Approve on a hidden page).
// nosniff: browsers never guess a file's type. Referrer-Policy: other sites only
// see our domain, never a page's full address (report and export links carry tokens).
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
