// Runs the live agent tests (real Claude) with options:
//   node scripts/agent-tests.mjs --record      save each answer as the case's recorded answer
//   node scripts/agent-tests.mjs --stability   run each case 3 times and report verdict flips
// Anything else (e.g. -t "reputation") is passed to vitest. Reads ANTHROPIC_API_KEY from .env.local via npm.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes("--record")) env.RECORD = "1";
if (args.includes("--stability")) env.STABILITY = "3";
const rest = args.filter((a) => a !== "--record" && a !== "--stability");

const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "--config", "vitest.agents.config.mts", ...rest], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
