// Saved Growth cases (agents/tests/growth/*.json): the task (an owner's ask, the
// weekly plan, a calendar date, the birthday batch, special ideas), everything
// Growth would be given, what a right answer must look like (structure and rules,
// never exact wording), and the recorded answer.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { growthOutputProblems, NO_BASELINE, type GrowthContext, type GrowthDraftOutput, type GrowthTask } from "@/lib/agents/growth-rules";
import type { CheckerVerdictOutput } from "@/lib/agents/schema";

export type GrowthCase = {
  name: string;
  source: string;
  task: GrowthTask;
  request: string | null;
  today: string; // YYYY-MM-DD
  today_words: string;
  profile: { version: number; fields: Record<string, unknown> };
  segments: GrowthContext["segments"];
  history: GrowthContext["history"];
  calendar: { day: string; name: string; type: string; date_uncertain: boolean }[];
  quiet_times: string | null;
  send_window: { start: string; end: string };
  expect: {
    outcome: "draft" | "question" | "none";
    // A question for the owner is also a right answer.
    question_ok?: boolean;
    types?: GrowthDraftOutput["type"][];
    segment?: string;
    offer_types?: string[];
    // At least one of these (case-insensitive) in the drafts or the question.
    mention_any?: string[];
    must_not_contain?: string[];
    expected_outcome?: "baseline" | "history";
    max_drafts?: number;
    checker?: CheckerVerdictOutput["verdict"][];
  };
  recorded: {
    outcomes: { outcome: "reply" | "question"; question_by: "growth" | "checker" | null; question: string | null; output: GrowthDraftOutput; checker: Pick<CheckerVerdictOutput, "verdict" | "checks" | "minor_fixes" | "owner_question"> | null; revisions: number }[];
    agent_version: string;
    checker_version: string | null;
    recorded_at: string;
  } | null;
};

export const GROWTH_DIR = join("agents", "tests", "growth");

export function loadGrowthCases() {
  return readdirSync(GROWTH_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(GROWTH_DIR, file), "utf8")) as GrowthCase }));
}

export function saveGrowthRecorded(file: string, recorded: GrowthCase["recorded"]) {
  const path = join(GROWTH_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as GrowthCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

export function caseContext(c: GrowthCase, task: GrowthTask = c.task): GrowthContext {
  const library = (c.profile.fields.photo_library ?? []) as { id: string }[];
  return { task, today: c.today, profile: c.profile.fields as GrowthContext["profile"], segments: c.segments, history: c.history, photoIds: library.map((p) => p.id), sendWindow: c.send_window };
}

export type GrowthResult = { outcome: "reply" | "question"; by: "growth" | "checker" | null; question: string | null; output: GrowthDraftOutput; checker: { verdict: string } | null };

// What's wrong with a run's results (one per draft) for this case. Empty = right.
export function judgeGrowth(c: GrowthCase, results: GrowthResult[]) {
  const e = c.expect;
  const problems: string[] = [];
  const all = results
    .flatMap((r) => [r.question ?? "", r.output.needs_owner_input ?? "", r.output.name, ...Object.values(r.output.content), r.output.offer ? `${r.output.offer.description} ${r.output.offer.conditions}` : "", r.output.idea ? JSON.stringify(r.output.idea) : ""])
    .join("\n")
    .toLowerCase();
  const questions = results.filter((r) => r.outcome === "question");
  const drafts = results.filter((r) => r.outcome === "reply");

  if (e.outcome === "none") {
    if (results.length) problems.push(`expected nothing this week, got ${results.length} draft(s)`);
  } else if (e.outcome === "question") {
    if (!questions.length) problems.push(`expected a question for the owner, got a draft: ${drafts[0]?.output.content.subject ?? ""}`);
  } else if (!drafts.length && !(e.question_ok && questions.length)) {
    problems.push(`expected a draft, got ${questions.length ? `a question (${questions[0].by}): ${questions[0].question}` : "nothing"}`);
  }
  if (e.max_drafts !== undefined && results.length > e.max_drafts) problems.push(`at most ${e.max_drafts} drafts (got ${results.length})`);

  const ctx = caseContext(c, c.task === "weekly_plan" || c.task === "special_ideas" ? c.task : "revision");
  for (const r of drafts) {
    const d = r.output;
    problems.push(...growthOutputProblems({ drafts: [d] }, { ...ctx, task: "revision" }));
    if (e.types && !e.types.includes(d.type)) problems.push(`type ${d.type}, expected ${e.types.join(" or ")}`);
    if (e.segment && d.segment !== e.segment) problems.push(`segment ${d.segment}, expected ${e.segment}`);
    if (e.offer_types && d.offer && !e.offer_types.includes(d.offer.type)) problems.push(`offer type ${d.offer.type}, expected ${e.offer_types.join(" or ")}`);
    if (e.expected_outcome === "baseline" && d.expected_outcome.trim() !== NO_BASELINE) problems.push(`expected_outcome should say "${NO_BASELINE}"`);
    if (e.expected_outcome === "history" && !d.sources_used.some((s) => s.startsWith("history:"))) problems.push("expected_outcome should quote the comparable past campaign (history:<id>)");
    if (e.checker) {
      if (!r.checker) problems.push("no checker verdict");
      else if (!e.checker.includes(r.checker.verdict as never)) problems.push(`checker said ${r.checker.verdict}, expected ${e.checker.join(" or ")}`);
    }
  }
  if (e.mention_any?.length && !e.mention_any.some((w) => all.includes(w.toLowerCase()))) problems.push(`should mention one of: ${e.mention_any.join(", ")}`);
  for (const w of e.must_not_contain ?? []) if (all.includes(w.toLowerCase())) problems.push(`must not contain "${w}"`);
  return problems;
}
