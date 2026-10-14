import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live agent tests: the real agents (real Claude) against the saved cases in
// agents/tests/. Costs a little each run, so they run on demand
// (npm run test:agents, or by hand on GitHub: Actions > Agent tests). npm test
// runs the offline ones.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src/")}` },
      { find: /^server-only$/, replacement: here("./tests/support/empty.ts") },
    ],
  },
  test: {
    include: ["tests/agents-live/**/*.eval.ts"],
    environment: "node",
    testTimeout: 900_000, // 3 runs, each up to 2 revisions with a preview picture
    // One case at a time, so a run stays well within the API's rate limits.
    fileParallelism: false,
  },
});
