// Saved Visibility cases (agents/tests/visibility/*.json): the task (a Google
// post, a photo, a profile change, the weekly brief), what Visibility would be
// given, what a right answer must look like (structure and rules, never exact
// wording), and the recorded answer.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckerVerdictOutput } from "@/lib/agents/schema";
import { visibilityProblems, type PhotoReason, type ProfileChangedEvent, type VisibilityOutput, type VisibilityTask } from "@/lib/agents/visibility-rules";

export type VisibilityCase = {
  name: string;
  source: string;
  task: VisibilityTask;
  profile: { version: number; fields: Record<string, unknown> };
  history: { recent_posts: { date: string; text: string }[] };
  slot: "Monday" | "Thursday" | "owner_request" | null;
  request: string | null;
  photo: { url?: string; description?: string; note: string; sender: "owner" | "staff" } | null;
  event: ProfileChangedEvent | null;
  trends: string[];
  today: string;
  expect: {
    types: VisibilityOutput["type"][];
    // A question for the owner is also a right answer.
    question_ok?: boolean;
    // For photos: must it be judged usable or not, and for which reasons.
    usable?: boolean;
    reasons?: PhotoReason[];
    // Words that must not appear (case-insensitive), e.g. a phone number or an invented claim.
    must_not_contain?: string[];
    change_field?: string;
    shoots?: number;
    checker?: CheckerVerdictOutput["verdict"][];
  };
  recorded: {
    outcome: "reply" | "question" | "unusable";
    question_by: "visibility" | "checker" | null;
    question: string | null;
    output: VisibilityOutput;
    checker: Pick<CheckerVerdictOutput, "verdict" | "checks" | "minor_fixes" | "owner_question"> | null;
    revisions: number;
    agent_version: string;
    checker_version: string | null;
    recorded_at: string;
  } | null;
};

export const VISIBILITY_DIR = join("agents", "tests", "visibility");

export function loadVisibilityCases() {
  return readdirSync(VISIBILITY_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(VISIBILITY_DIR, file), "utf8")) as VisibilityCase }));
}

export function saveVisibilityRecorded(file: string, recorded: VisibilityCase["recorded"]) {
  const path = join(VISIBILITY_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as VisibilityCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

export type VisibilityResult = {
  outcome: "reply" | "question" | "unusable";
  by?: "visibility" | "checker" | null;
  question?: string | null;
  output: VisibilityOutput;
  checker: { verdict: string } | null;
};

// What's wrong with a result for this case. Empty = it's right.
export function judgeVisibility(c: VisibilityCase, r: VisibilityResult) {
  const e = c.expect;
  if (r.outcome === "question") return e.question_ok ? [] : [`expected a draft, got a question (${r.by}): ${r.question ?? ""}`];
  const out = r.output;
  const problems = visibilityProblems(out, { task: c.task, profile: c.profile.fields, event: c.event });
  if (r.outcome === "unusable") {
    if (e.usable !== false) problems.push(`the photo was judged unusable (${out.photo_check?.reason_code}: ${out.photo_check?.reason})`);
    else if (e.reasons && !e.reasons.includes(out.photo_check!.reason_code)) problems.push(`unusable for ${out.photo_check!.reason_code}, expected ${e.reasons.join(" or ")}`);
    return problems;
  }
  if (e.usable === false) problems.push("the photo should have been judged unusable");
  if (!e.types.includes(out.type)) problems.push(`type ${out.type}, expected ${e.types.join(" or ")}`);
  const allText = [out.content.text, ...out.shoots.map((s) => `${s.what} ${s.how} ${s.caption} ${s.hashtags.join(" ")}`)].join("\n");
  for (const w of e.must_not_contain ?? []) if (allText.toLowerCase().includes(w.toLowerCase())) problems.push(`must not contain "${w}"`);
  if (e.change_field && out.change?.field !== e.change_field) problems.push(`change.field is ${out.change?.field}, expected ${e.change_field}`);
  if (e.shoots !== undefined && out.shoots.length !== e.shoots) problems.push(`${out.shoots.length} shoots, expected ${e.shoots}`);
  if (e.checker) {
    if (!r.checker) problems.push("no checker verdict");
    else if (!e.checker.includes(r.checker.verdict as never)) problems.push(`checker said ${r.checker.verdict}, expected ${e.checker.join(" or ")}`);
  }
  return problems;
}
