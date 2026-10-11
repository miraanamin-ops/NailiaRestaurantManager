// Which of the checker's rubric checks apply to a draft, which agent made it,
// and when owner-only output is checked at all. No imports from the app, so
// it's unit-tested (tests/agents/checker.test.ts).
import type { AgentName } from "./definition";
import type { CheckId } from "./schema";

export type Audience = "customer" | "owner_only" | "profile_change";

const T: CheckId[] = ["T1", "T2", "T3", "T4", "T5"];
const F: CheckId[] = ["F1", "F2", "F3", "F4", "F5"];
const C: CheckId[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
const B: CheckId[] = ["B1", "B2", "B3", "B4"];

const CUSTOMER_KINDS = ["review_reply", "email_campaign", "google_post", "promotion", "other"];
const PROFILE_KINDS = ["hours_update", "menu_update", "profile_change"];

export function audienceOf(kind: string): Audience {
  if (PROFILE_KINDS.includes(kind)) return "profile_change";
  if (CUSTOMER_KINDS.includes(kind)) return "customer";
  return "owner_only";
}

// checker.md "Which checks apply". Brand checks need a rendered preview, which
// exists for emails only for now: for posts and cards B1 to B4 are skipped.
export function applicableChecks(audience: Audience, hasPreview: boolean): { applicable: CheckId[]; skipped: CheckId[] } {
  if (audience === "customer") return hasPreview ? { applicable: [...T, ...F, ...C, ...B], skipped: [] } : { applicable: [...T, ...F, ...C], skipped: B };
  // Owner-only (decision 3): facts and C6 only.
  if (audience === "owner_only") return { applicable: [...F, "C6"], skipped: [] };
  return { applicable: [...F, "C1"], skipped: [] };
}

// Owner-only output is checked only when it carries figures or sources.
// Conversational replies with neither skip the checker. Customer-facing drafts
// and profile changes are always checked.
export function needsChecker(output: { kind: string; figures?: unknown[] | null; sources_used?: unknown[] | null }) {
  if (audienceOf(output.kind) !== "owner_only") return true;
  return Boolean(output.figures?.length || output.sources_used?.length);
}

// The agent whose Rules the draft is checked against (C8).
export function makerFor(kind: string): AgentName {
  if (kind === "review_reply") return "reputation";
  if (kind === "email_campaign" || kind === "promotion" || kind === "birthday_batch" || kind === "special_idea") return "growth";
  if (["report_section", "answer", "menu_matrix", "rival_watch", "zreport_extract"].includes(kind)) return "insights";
  return "visibility";
}

// One line for the audit log: the verdict, what failed, and any minor fixes.
export function verdictLine(v: {
  verdict: string;
  checks: { id: string; result: string; reason: string | null }[];
  minor_fixes: { find: string; replace: string }[];
  owner_question: string | null;
}) {
  const failed = v.checks.filter((c) => c.result === "fail").map((c) => `${c.id}: ${c.reason ?? "failed"}`);
  const parts = [v.verdict];
  if (failed.length) parts.push(failed.join("; "));
  if (v.owner_question) parts.push(`asks: ${v.owner_question}`);
  if (v.minor_fixes.length) parts.push(`${v.minor_fixes.length} minor fix${v.minor_fixes.length === 1 ? "" : "es"} (${v.minor_fixes.map((f) => `"${f.find}" → "${f.replace}"`).join(", ")})`);
  const line = parts.join(". ");
  return line.length > 400 ? `${line.slice(0, 399)}…` : line;
}
