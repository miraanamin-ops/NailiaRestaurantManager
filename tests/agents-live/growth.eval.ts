// The Growth agent, live: each saved case (agents/tests/growth/) goes through the
// real loop (Growth, then the checker on each draft with a picture of the email,
// up to 2 revisions) with real Claude, and the result must pass the case.
// Same commands as the others (npm run test:agents / test:agents:stability / test:agents:record).
import { describe, expect, test, vi } from "vitest";
import type { Resolved } from "@/lib/agents/tools";
import type { Usage } from "@/lib/agents/usage";
import { judgeGrowth, loadGrowthCases, saveGrowthRecorded, type GrowthCase } from "../agents/support/growth-cases";
import { hasKey, RECORD, reportRuns, RUNS } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

const resolverFor = (c: GrowthCase) => async (refs: string[]): Promise<Resolved[]> =>
  refs.map((ref) => {
    const id = ref.slice(ref.indexOf(":") + 1);
    if (ref.startsWith("profile:") && id in c.profile.fields) return { ref, found: true, data: c.profile.fields[id] ?? null };
    if (ref.startsWith("segment:") && id in c.segments) return { ref, found: true, data: { segment: id, can_be_emailed: c.segments[id] } };
    if (ref.startsWith("history:")) {
      const h = c.history.find((x) => x.id === id);
      if (h) return { ref, found: true, data: h };
    }
    if (ref.startsWith("request:") && c.request) return { ref, found: true, data: { owner_asked: c.request } };
    return { ref, found: false, reason: "not in this case's data" };
  });

describe.skipIf(!hasKey)("growth (live)", () => {
  test.each(loadGrowthCases())("$file", async ({ file, case: c }) => {
    const { growthLoop } = await import("@/lib/agents/growth-core");
    const { growthPreviewPng } = await import("@/lib/agents/growth-preview");
    const f = c.profile.fields;
    const brand = { name: String(f.name), tagline: null, address: (f.address as string) ?? null, logo_url: null, brand_color: "#c2410c", brand_dark: "#1c1917", brand_voice: (f.tone_notes as string) ?? null, owner_name: null };
    const verdicts: string[] = [];
    const usages: Usage[] = [];
    const wrong: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const started = Date.now();
      const outcome = await growthLoop(
        { task: c.task as never, request: c.request, profile: c.profile, segments: c.segments, history: c.history, calendar: c.calendar, quiet_times: c.quiet_times, today: c.today, today_words: c.today_words, send_window: c.send_window },
        { resolve: resolverFor(c), checkerProfile: c.profile, recent: [], preview: (d) => growthPreviewPng(brand, d) },
        `case ${file}`,
      );
      const results = outcome.drafts.map((d) => ({ outcome: d.kind, by: d.kind === "question" ? (d.by === "maker" ? ("growth" as const) : ("checker" as const)) : null, question: d.kind === "question" ? d.question : null, output: d.output, checker: d.checker }));
      verdicts.push(`${results.map((r) => (r.outcome === "reply" ? `${r.output.type}/${r.checker?.verdict}` : `question by ${r.by}`)).join("+") || "nothing"} (${Math.round((Date.now() - started) / 1000)}s)`);
      usages.push(outcome.usage);
      const problems = judgeGrowth(c, results);
      if (problems.length) wrong.push(`run ${run}: ${problems.join("; ")} :: ${results.map((r) => r.question ?? `${r.output.content.subject} / ${r.output.content.body}`).join(" || ")}`);
      if (RECORD && run === 1) {
        saveGrowthRecorded(file, {
          outcomes: outcome.drafts.map((d, i) => ({
            outcome: d.kind,
            question_by: results[i].by,
            question: results[i].question,
            output: d.output,
            checker: d.checker ? { verdict: d.checker.verdict, checks: d.checker.checks, minor_fixes: d.checker.minor_fixes, owner_question: d.checker.owner_question } : null,
            revisions: d.revisions,
          })),
          agent_version: outcome.agentVersion,
          checker_version: outcome.drafts.find((d) => d.checkerVersion)?.checkerVersion ?? null,
          recorded_at: new Date().toISOString(),
        });
      }
    }
    reportRuns("growth", file, verdicts.map((v) => v.replace(/ \(\d+s\)$/, "")), usages);
    console.log(`growth ${file} times: ${verdicts.map((v) => v.match(/\((\d+s)\)$/)?.[1]).join(", ")}`);
    expect(wrong).toEqual([]);
  });
});
