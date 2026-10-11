// The Reputation agent, live: each saved case (agents/tests/reputation/) goes
// through the real loop (Reputation, the checker, up to 2 revisions) with real
// Claude, and the result must pass the case. Same commands as the checker's
// (npm run test:agents / test:agents:stability / test:agents:record).
import { describe, expect, test, vi } from "vitest";
import type { Resolved } from "@/lib/agents/tools";
import { judgeReputation, loadReputationCases, saveReputationRecorded, type ReputationCase } from "../agents/support/reputation-cases";
import { hasKey, RECORD, reportRuns, RUNS } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

// The data behind sources_used, from the case itself (what resolve_sources would find).
function resolverFor(c: ReputationCase) {
  return async (refs: string[]): Promise<Resolved[]> =>
    refs.map((ref) => {
      const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
      if (kind === "review" && id === c.review.id) return { ref, found: true, data: c.review };
      if (kind === "profile" && id in c.profile.fields) return { ref, found: true, data: c.profile.fields[id] ?? null };
      return { ref, found: false, reason: "not in this case's data" };
    });
}

describe.skipIf(!hasKey)("reputation (live)", () => {
  test.each(loadReputationCases())("$file", async ({ file, case: c }) => {
    const { reputationLoop } = await import("@/lib/agents/reputation-core");
    const verdicts: string[] = [];
    const wrong: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const outcome = await reputationLoop(
        { review: c.review, profile: c.profile, history: c.history, owner_choice: c.owner_choice, today: c.today },
        { resolve: resolverFor(c), checkerProfile: c.profile, recent: c.history.recent_replies },
        `case ${file}`,
      );
      // What happened, in one word: reply (with the checker's verdict), or who asked the owner.
      verdicts.push(outcome.kind === "reply" ? `reply/${outcome.checker.verdict}` : `question by ${outcome.by}`);
      let problems: string[];
      if (outcome.kind === "question" && outcome.by === "checker") {
        // The checker escalated: right only when the owner should be asked anyway.
        problems = c.expect.needs_owner_input ? [] : [`the checker escalated after ${outcome.revisions} revisions: ${outcome.question}`];
      } else {
        problems = judgeReputation(c, outcome.output, outcome.kind === "reply" ? outcome.checker : null);
      }
      if (problems.length) wrong.push(`run ${run}: ${problems.join("; ")}`);
      if (RECORD && run === 1) {
        saveReputationRecorded(file, {
          output: outcome.output,
          checker: outcome.checker ? { verdict: outcome.checker.verdict, checks: outcome.checker.checks, minor_fixes: outcome.checker.minor_fixes, owner_question: outcome.checker.owner_question } : null,
          revisions: outcome.revisions,
          model: "claude-sonnet-5-5",
          agent_version: outcome.agentVersion,
          checker_version: outcome.checkerVersion,
          recorded_at: new Date().toISOString(),
        });
      }
    }
    reportRuns("reputation", file, verdicts);
    expect(wrong).toEqual([]);
  });
});
