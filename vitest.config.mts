import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests (npm test). No database, no network: anything that would talk to
// Supabase, Twilio or Claude is replaced with a stand-in inside each test.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src/")}` },
      // Next.js blocks server code from reaching the browser with this import; in tests it's a no-op.
      { find: /^server-only$/, replacement: here("./tests/support/empty.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,mts}"],
    environment: "node",
    // Clears the switches Vercel's build would otherwise pass in, and answers
    // "start a queue worker" calls without the network (see the files).
    setupFiles: ["tests/support/switch-env.ts", "tests/support/no-worker-calls.ts"],
    // The first test in a file also loads the app's code, which can take a few
    // seconds on a cold start (e.g. on GitHub); don't fail on that.
    testTimeout: 30_000,
    // Several files build a whole Postgres (PGlite) in beforeAll (the queue, the
    // queue simulation, the schema tests). On a busy machine that took over the
    // 10 s default and failed the file before any test ran (seen on the queue tests;
    // each passes on its own every time, so it was load, not a race).
    hookTimeout: 120_000,
    restoreMocks: true,
  },
});
