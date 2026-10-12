// Saved Reputation cases (agents/tests/reputation/*.json): a real or test review,
// what Reputation would be given, and what a right answer must look like
// (structure and rules, never exact wording), plus the recorded answer.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reputationProblems, type ReplyProfile, type ReputationReplyOutput, type ReviewInput } from "@/lib/agents/reputation-rules";
import type { CheckerVerdictOutput } from "@/lib/agents/schema";

export type ReputationCase = {
  name: string;
  source: string;
  review: ReviewInput & { review_date?: string };
  profile: { version: number; fields: ReplyProfile & Record<string, unknown> };
  history: { recent_replies: string[]; owner_edits: { note: string; before: string; after: string }[] };
  owner_choice: { choice: "public" | "both"; question: string } | null;
  today: string;
  // A known disagreement waiting for the owner's decision (e.g. two agent files
  // disagree). Its recorded answer is reported as skipped, not judged, until then.
  pending_decision?: string;
  expect: {
    alert: boolean;
    needs_owner_input: boolean;
    // A careful reply or a question for the owner are both right (e.g. a claim Reputation can't check).
    question_ok?: boolean;
    sources_must_include: string[];
    language?: "es";
    max_sentences?: number;
    // Acceptable checker verdicts on the final reply (left out when a question is expected).
    checker?: CheckerVerdictOutput["verdict"][];
  };
  recorded: {
    // What happened: a reply, or a question (asked by Reputation, or the checker escalated).
    outcome?: "reply" | "question";
    question_by?: "reputation" | "checker" | null;
    question?: string | null;
    output: ReputationReplyOutput;
    checker: Pick<CheckerVerdictOutput, "verdict" | "checks" | "minor_fixes" | "owner_question"> | null;
    revisions: number;
    model: string;
    agent_version: string;
    checker_version: string | null;
    recorded_at: string;
  } | null;
};

export const REPUTATION_DIR = join("agents", "tests", "reputation");

export function loadReputationCases() {
  return readdirSync(REPUTATION_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(REPUTATION_DIR, file), "utf8")) as ReputationCase }));
}

export function saveReputationRecorded(file: string, recorded: ReputationCase["recorded"]) {
  const path = join(REPUTATION_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as ReputationCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

// Sentences in the reply, not counting the sign-off line.
export function sentenceCount(text: string, signOff: string | null | undefined) {
  const body = signOff ? text.replace(signOff, "") : text;
  return body.split(/(?<=[.!?])\s+/).filter((s) => /[a-z]/i.test(s)).length;
}

const SPANISH = /\b(?:gracias|muchas|nos|alegra|volver|pronto|equipo|vuestra|vuestro|tu|su|el|la|los|las|que|para|con|muy)\b/gi;
const ENGLISH = /\b(?:the|thank|thanks|you|your|we|our|and|soon|glad)\b/gi;

// The whole outcome: a reply, or a question (by Reputation or by the checker).
export function judgeOutcome(
  c: ReputationCase,
  o: { kind: "reply" | "question"; by?: "reputation" | "checker" | null; question?: string | null; output: ReputationReplyOutput; checker: { verdict: string } | null },
) {
  if (o.kind === "question" && (c.expect.question_ok || (c.expect.needs_owner_input && o.by === "checker"))) return [];
  if (o.kind === "question" && o.by === "checker") return [`the checker escalated: ${o.question ?? ""}`];
  return judgeReputation(c, o.output, o.kind === "reply" ? o.checker : null);
}

// What's wrong with an answer for this case. Empty = it's right.
export function judgeReputation(c: ReputationCase, out: ReputationReplyOutput, checker: { verdict: string } | null) {
  const problems = reputationProblems(out, { review: c.review, profile: c.profile.fields });
  if (out.alert !== c.expect.alert) problems.push(`alert is ${out.alert}, expected ${c.expect.alert}`);
  if (Boolean(out.needs_owner_input) !== c.expect.needs_owner_input) {
    problems.push(c.expect.needs_owner_input ? "expected a question for the owner (needs_owner_input), got a reply" : `expected a reply, got a question: ${out.needs_owner_input}`);
  }
  for (const ref of c.expect.sources_must_include) if (out.content.text && !out.sources_used.includes(ref)) problems.push(`sources_used is missing ${ref}`);
  const text = out.content.text;
  if (c.expect.language === "es" && text) {
    const es = (text.match(SPANISH) ?? []).length;
    const en = (text.match(ENGLISH) ?? []).length;
    if (es < 3 || en > es) problems.push("the reply should be in Spanish, like the review");
  }
  if (c.expect.max_sentences && text && sentenceCount(text, c.profile.fields.sign_off_name) > c.expect.max_sentences) {
    problems.push(`the reply has ${sentenceCount(text, c.profile.fields.sign_off_name)} sentences, at most ${c.expect.max_sentences} expected`);
  }
  if (c.expect.checker && text) {
    if (!checker) problems.push("no checker verdict on the reply");
    else if (!c.expect.checker.includes(checker.verdict as never)) problems.push(`checker said ${checker.verdict}, expected ${c.expect.checker.join(" or ")}`);
  }
  return problems;
}
