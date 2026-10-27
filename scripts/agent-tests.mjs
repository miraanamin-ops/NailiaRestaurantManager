// Runs the live agent tests (real Claude) with options:
//   node scripts/agent-tests.mjs --record      save each answer as the case's recorded answer
//   node scripts/agent-tests.mjs --stability   run each case 3 times and report verdict flips
//   node scripts/agent-tests.mjs --budget 40   the most these runs may spend in all, in dollars (default 40)
//   node scripts/agent-tests.mjs --reset-spend start a new budget (the total so far is kept until then)
// Anything else (e.g. -t "reputation") is passed to vitest. Reads ANTHROPIC_API_KEY from .env.local via npm.
// What's been spent is in tests/agents-live/.results/spend.json (tests/agents-live/spend.ts).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const SPEND_FILE = "tests/agents-live/.results/spend.json";
const args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes("--record")) env.RECORD = "1";
if (args.includes("--stability")) env.STABILITY = "3";
const budgetAt = args.indexOf("--budget");
if (budgetAt >= 0) env.AGENT_TEST_BUDGET = args[budgetAt + 1];
if (args.includes("--reset-spend") && existsSync(SPEND_FILE)) rmSync(SPEND_FILE);
const rest = args.filter((a, i) => !["--record", "--stability", "--reset-spend", "--budget"].includes(a) && args[i - 1] !== "--budget");

const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "--config", "vitest.agents.config.mts", ...rest], {
  stdio: "inherit",
  env,
});
if (existsSync(SPEND_FILE)) {
  const l = JSON.parse(readFileSync(SPEND_FILE, "utf8"));
  console.log(`\nTest spend so far: $${l.total.toFixed(2)} of $${l.budget} (${l.calls} Claude calls since ${l.started_at.slice(0, 16)})`);
}
process.exit(result.status ?? 1);
