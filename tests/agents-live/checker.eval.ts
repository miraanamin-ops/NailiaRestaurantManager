// The checker agent, live: each saved case (agents/tests/checker/) goes to the
// real checker (the current agents/checker.md and house rules, real Claude),
// and the verdict must be valid and get the case right.
//   npm run test:agents          run them
//   npm run test:agents:record   run them and save each answer as the case's recorded answer
// Needs ANTHROPIC_API_KEY. Nothing reaches a customer, owner or platform.
import { describe, expect, test, vi } from "vitest";
import { judge, loadCases, saveRecorded } from "../agents/support/checker-cases";

const record = process.env.RECORD === "1";
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

// Builder alerts are not sent from test runs.
vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

describe.skipIf(!hasKey)("checker (live)", () => {
  test.each(loadCases())("$file", async ({ file, case: c }) => {
    const { runChecker } = await import("@/lib/agents/checker-core");
    const { loadAgent } = await import("@/lib/agents/loader");
    const result = await runChecker({ ...c, makerRules: loadAgent(c.maker).rules, preview: null }, `case ${file}`);
    const problems = judge(c, result.output);
    if (record) saveRecorded(file, { ...result.output, model: result.model, agent_version: result.agentVersion, recorded_at: new Date().toISOString() });
    console.log(`${file}: ${result.output.verdict}${problems.length ? ` (WRONG: ${problems.join("; ")})` : ""}`);
    expect(problems).toEqual([]);
  });
});
