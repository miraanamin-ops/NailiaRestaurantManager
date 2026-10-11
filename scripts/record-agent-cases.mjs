// Runs the live agent tests and saves each answer as the case's recorded answer
// (agents/tests/<agent>/*.json), which the offline tests then check on every push.
// Usage: npm run test:agents:record   (reads ANTHROPIC_API_KEY from .env.local)
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "--config", "vitest.agents.config.mts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, RECORD: "1" },
});
process.exit(result.status ?? 1);
