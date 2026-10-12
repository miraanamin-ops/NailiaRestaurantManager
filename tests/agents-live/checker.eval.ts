// The checker agent, live: each saved case (agents/tests/checker/) goes to the
// real checker (the current agents/checker.md and house rules, real Claude),
// and the verdict must be valid and get the case right.
//   npm run test:agents             run them
//   npm run test:agents:stability   run each case 3 times and report verdict flips
//   npm run test:agents:record      run them and save each answer as the case's recorded answer
// Needs ANTHROPIC_API_KEY. Nothing reaches a customer, owner or platform.
import { describe, expect, test, vi } from "vitest";
import type { Usage } from "@/lib/agents/usage";
import { judge, loadCases, saveRecorded } from "../agents/support/checker-cases";
import { hasKey, RECORD, reportRuns, RUNS } from "./support";

// Builder alerts are not sent from test runs.
vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

describe.skipIf(!hasKey)("checker (live)", () => {
  test.each(loadCases())("$file", async ({ file, case: c }) => {
    const { runChecker } = await import("@/lib/agents/checker-core");
    const { loadAgent } = await import("@/lib/agents/loader");
    const verdicts: string[] = [];
    const usages: Usage[] = [];
    const wrong: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const result = await runChecker({ ...c, makerRules: loadAgent(c.maker).rules, preview: null }, `case ${file}`);
      verdicts.push(result.output.verdict);
      usages.push(result.usage);
      const problems = judge(c, result.output);
      if (problems.length) wrong.push(`run ${run}: ${problems.join("; ")}`);
      if (RECORD && run === 1) saveRecorded(file, { ...result.output, model: result.model, agent_version: result.agentVersion, recorded_at: new Date().toISOString() });
    }
    reportRuns("checker", file, verdicts, usages);
    expect(wrong).toEqual([]);
  });
});
