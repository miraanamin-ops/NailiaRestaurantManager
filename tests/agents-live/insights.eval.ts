// The Insights agent, live: each saved case (agents/tests/insights/) goes through
// the real loop (Insights with query_metrics over the case's saved numbers, the
// checker, up to 2 revisions) with real Claude, and the result must pass the case.
// Same commands as the others (npm run test:agents / test:agents:stability / test:agents:record).
import { describe, expect, test, vi } from "vitest";
import type { MetricQueryInput } from "@/lib/agents/insights-metrics";
import type { Resolved } from "@/lib/agents/tools";
import type { Usage } from "@/lib/agents/usage";
import { caseData, judgeInsights, loadInsightsCases, saveInsightsRecorded, type InsightsCase } from "../agents/support/insights-cases";
import { hasKey, RECORD, reportRuns, RUNS } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

const resolverFor = (c: InsightsCase) => async (refs: string[]): Promise<Resolved[]> =>
  refs.map((ref) => {
    const id = ref.slice(ref.indexOf(":") + 1);
    if (ref.startsWith("profile:") && id in c.profile.fields) return { ref, found: true, data: c.profile.fields[id] ?? null };
    return { ref, found: false, reason: "not in this case's data" };
  });

describe.skipIf(!hasKey)("insights (live)", () => {
  test.each(loadInsightsCases())("$file", async ({ file, case: c }) => {
    const { insightsLoop, REPORT_QUERIES } = await import("@/lib/agents/insights-core");
    const verdicts: string[] = [];
    const usages: Usage[] = [];
    const wrong: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const started = Date.now();
      const outcome = await insightsLoop(
        { task: c.task, question: c.question, profile: c.profile, data: caseData(c), prepared: c.task === "report" ? REPORT_QUERIES : [], themes: c.themes, today: c.today_words },
        { resolve: resolverFor(c), checkerProfile: c.profile },
        `case ${file}`,
      );
      const by = outcome.kind === "question" ? (outcome.by === "maker" ? "insights" : "checker") : null;
      verdicts.push(`${outcome.kind === "reply" ? `${outcome.output.type}/${outcome.checker.verdict}` : `question by ${by}`} (${Math.round((Date.now() - started) / 1000)}s)`);
      usages.push(outcome.usage);
      const results = new Map(outcome.queries.map((q) => [q.id, q]));
      const problems = judgeInsights(c, { outcome: outcome.kind, by, question: outcome.kind === "question" ? outcome.question : null, output: outcome.output, results, checker: outcome.checker });
      if (problems.length) wrong.push(`run ${run}: ${problems.join("; ")} :: ${outcome.kind === "question" ? outcome.question : outcome.output.content.body}`);
      if (RECORD && run === 1) {
        saveInsightsRecorded(file, {
          outcome: outcome.kind,
          question_by: by,
          question: outcome.kind === "question" ? outcome.question : null,
          output: outcome.output,
          queries: outcome.queryInputs as MetricQueryInput[],
          checker: outcome.checker ? { verdict: outcome.checker.verdict, checks: outcome.checker.checks, minor_fixes: outcome.checker.minor_fixes, owner_question: outcome.checker.owner_question } : null,
          revisions: outcome.revisions,
          agent_version: outcome.agentVersion,
          checker_version: outcome.checkerVersion,
          recorded_at: new Date().toISOString(),
        });
      }
    }
    reportRuns("insights", file, verdicts.map((v) => v.replace(/ \(\d+s\)$/, "")), usages);
    console.log(`insights ${file} times: ${verdicts.map((v) => v.match(/\((\d+s)\)$/)?.[1]).join(", ")}`);
    expect(wrong).toEqual([]);
  });
});
