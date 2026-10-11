// The shapes agents must return, and the plain-code rules on top of them.
// Zod only (no app imports), so every rule is unit-tested (tests/agents/schema.test.ts).
//
//   Draft (house rules section 9): every maker agent's output. Agent-specific
//     fields are added per agent (phase 2 on); the shared part is checked here.
//   Profile change: the profile keeper's output. Not a draft.
//   Checker verdict: pass / fail / escalate, one result per applicable check.
import { z } from "zod";
import { parseSourceRef } from "./sources";

export type Problems = string[];

// Written as a code so the em-dash scan (tests/agents/cases.test.ts) passes this file.
const EM_DASH = new RegExp(String.fromCharCode(0x2014));

// ---------- Drafts ----------

export const DraftBase = z.looseObject({
  type: z.string().min(1),
  channel: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
  needs_owner_input: z.string().nullable(),
  sources_used: z.array(z.string()),
});
export type DraftOutput = z.infer<typeof DraftBase>;

// Set by code, never by an agent (house rules section 9).
const CODE_ONLY_FIELDS = ["draft_id", "created_at", "updated_at", "trust_level"];

const hasText = (v: unknown): boolean =>
  typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.some(hasText) : v && typeof v === "object" ? Object.values(v).some(hasText) : false;

export function draftProblems(raw: unknown): Problems {
  const parsed = DraftBase.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`);
  const d = parsed.data;
  const problems: Problems = [];
  for (const f of CODE_ONLY_FIELDS) if (f in d) problems.push(`${f} is set by code; leave it out`);
  if (d.needs_owner_input !== null && !d.needs_owner_input.trim()) problems.push("needs_owner_input must be null or a question");
  if (d.needs_owner_input && hasText(d.content)) problems.push("needs_owner_input is set, so content must be empty (no customer-facing text in the same draft)");
  if (!d.needs_owner_input && !hasText(d.content)) problems.push("content is empty");
  if (!d.needs_owner_input && d.sources_used.length === 0) problems.push("sources_used is empty: every claim must trace to a source");
  for (const s of d.sources_used) if (!parseSourceRef(s)) problems.push(`sources_used entry "${s}" isn't in the form kind:id`);
  return problems;
}

// ---------- Profile changes (the profile keeper) ----------

export const PROFILE_SECTIONS = ["identity", "owner", "voice", "facts", "commercial", "brand_kit", "insights", "learning", "controls"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type ChangeRule = "auto" | "confirm" | "settings";

export const ProfileChange = z.object({
  type: z.enum(["profile_change", "learning_summary"]),
  section: z.enum(PROFILE_SECTIONS),
  field: z.string().min(1),
  from: z.unknown(),
  to: z.unknown(),
  evidence: z.array(z.string()),
  apply: z.enum(["now", "after_owner_confirms"]),
  summary_line: z.string(),
});
export type ProfileChangeOutput = z.infer<typeof ProfileChange>;

// lookup: the field's section and change rule from the profile schema (null = no such field).
export function profileChangeProblems(raw: unknown, lookup: (field: string) => { section: ProfileSection; rule: ChangeRule } | null): Problems {
  const parsed = ProfileChange.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "change"}: ${i.message}`);
  const c = parsed.data;
  const problems: Problems = [];
  const field = lookup(c.field);
  if (!field) return [`${c.field} isn't a profile field`];
  if (field.section !== c.section) problems.push(`${c.field} is in the ${field.section} section, not ${c.section}`);
  // Never loosen a safeguard: settings-only fields can't be changed by an agent at all.
  if (field.rule === "settings") problems.push(`${c.field} changes only in settings; an agent can't change it`);
  if (field.rule === "confirm" && c.apply === "now") problems.push(`${c.field} needs the owner's yes first (apply: after_owner_confirms)`);
  if (c.type === "profile_change" && c.evidence.length === 0) problems.push("evidence is empty: list the decision ids or the owner's message");
  if (EM_DASH.test(c.summary_line)) problems.push("summary_line has an em-dash");
  return problems;
}

// ---------- Checker verdicts ----------

export const CHECK_IDS = [
  "T1", "T2", "T3", "T4", "T5",
  "F1", "F2", "F3", "F4", "F5",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
  "B1", "B2", "B3", "B4",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

// What the model returns (structured output). Nullable rather than optional fields,
// so the shape is fixed.
export const CheckerVerdict = z.object({
  verdict: z.enum(["pass", "fail", "escalate"]),
  checks: z.array(
    z.object({
      id: z.enum(CHECK_IDS),
      result: z.enum(["pass", "fail", "skipped"]),
      reason: z.string().nullable(),
      fix: z.string().nullable(),
    }),
  ),
  minor_fixes: z.array(z.object({ check: z.enum(CHECK_IDS), find: z.string(), replace: z.string() })),
  owner_question: z.string().nullable(),
  notes: z.string(),
});
export type CheckerVerdictOutput = z.infer<typeof CheckerVerdict>;

// Minor fixes are only for spelling, punctuation, em-dashes (T3, T5) and a price,
// name or date that differs from its source (F2, F3, F4). Anything bigger is a fail.
export const MINOR_FIX_CHECKS: CheckId[] = ["T3", "T5", "F2", "F3", "F4"];
const MAX_FIND = 80;

export function verdictProblems(
  raw: unknown,
  input: { applicable: CheckId[]; skipped: CheckId[]; draftText: string },
): Problems {
  const parsed = CheckerVerdict.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "verdict"}: ${i.message}`);
  const v = parsed.data;
  const problems: Problems = [];
  const listed = new Map(v.checks.map((c) => [c.id, c]));
  const missing = input.applicable.filter((id) => !listed.has(id));
  if (missing.length) problems.push(`checks missing from the list: ${missing.join(", ")} (list every applicable check, passed or not)`);
  for (const c of v.checks) {
    if (!input.applicable.includes(c.id) && !input.skipped.includes(c.id)) problems.push(`${c.id} doesn't apply to this draft`);
    if (c.result === "fail" && !c.reason) problems.push(`${c.id} failed without a reason`);
    if (c.result === "fail" && !c.fix && v.verdict === "fail") problems.push(`${c.id} failed without a fix instruction`);
  }
  const failed = v.checks.filter((c) => c.result === "fail");
  if (v.verdict === "pass" && failed.length) problems.push(`verdict is pass but ${failed.map((c) => c.id).join(", ")} failed`);
  if (v.verdict === "fail" && !failed.length) problems.push("verdict is fail but no check failed");
  if (v.verdict === "escalate" && !v.owner_question?.trim()) problems.push("verdict is escalate but there's no owner question");
  for (const f of v.minor_fixes) {
    if (!MINOR_FIX_CHECKS.includes(f.check)) problems.push(`minor fix under ${f.check}: only ${MINOR_FIX_CHECKS.join(", ")} can be minor fixes`);
    if (!f.find || !input.draftText.includes(f.find)) problems.push(`minor fix "${f.find}" isn't in the draft exactly as written`);
    if (f.find.length > MAX_FIND) problems.push(`minor fix "${f.find.slice(0, 30)}…" is too long to be minor`);
    if (EM_DASH.test(f.replace)) problems.push(`minor fix replacement "${f.replace}" has an em-dash`);
  }
  return problems;
}

// Applies minor fixes in order (each find replaced once). Used once the checker goes live;
// in shadow mode the fixes are only recorded.
export function applyMinorFixes(text: string, fixes: { find: string; replace: string }[]) {
  let out = text;
  for (const f of fixes) if (f.find && out.includes(f.find)) out = out.replace(f.find, () => f.replace);
  return out;
}
