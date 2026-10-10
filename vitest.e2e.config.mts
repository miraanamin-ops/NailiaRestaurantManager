import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// End-to-end onboarding runs against the REAL database, Claude and Google
// (they cost a little and make test restaurants). Not part of npm test. Run with:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts
// Needs TEST_MODE=true (new restaurants are demo ones) and E2E_MENU_DIR (folder with page1.jpg, page2.jpg).
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src/")}` },
      { find: /^server-only$/, replacement: here("./tests/support/empty.ts") },
    ],
  },
  test: { include: ["tests/e2e/**/*.e2e.ts"], environment: "node", testTimeout: 15 * 60_000, hookTimeout: 120_000, fileParallelism: false },
});
