// Trust levels: per restaurant and per task, how far a draft may go on its own.
//   draft_only  the owner gets the draft to use themselves; the gate never sends it
//   approve     the owner taps Approve (the default for every task)
//   auto        sent without a tap, but only if the checker agent (live) passed it
// Only the builder can set a level (settings page, builder controls). Campaigns,
// offers, hours, menu and profile changes can never be Auto, whatever is stored.
// No imports, so every rule is unit-tested (tests/gate.test.ts).

export const TRUST_LEVELS = ["draft_only", "approve", "auto"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

// The tasks drafts belong to: today's draft kinds, plus tasks the agents add later.
export const TASKS = [
  "review_reply",
  "google_post",
  "email_campaign",
  "promotion",
  "other",
  "birthday_batch",
  "special_idea",
  "content_brief",
  "hours_update",
  "menu_update",
  "profile_change",
] as const;
export type Task = (typeof TASKS)[number];

export const TASK_LABELS: Record<Task, string> = {
  review_reply: "Review replies",
  google_post: "Google posts",
  email_campaign: "Email campaigns",
  promotion: "Offers",
  other: "Other messages",
  birthday_batch: "Birthday emails",
  special_idea: "Special ideas",
  content_brief: "Content brief",
  hours_update: "Hours changes",
  menu_update: "Menu changes",
  profile_change: "Profile changes",
};

// Campaigns, offers, hours, menu and profile changes: never Auto (enforced here, in code).
export const NEVER_AUTO: ReadonlySet<Task> = new Set<Task>(["email_campaign", "promotion", "birthday_batch", "hours_update", "menu_update", "profile_change"]);
// Changes to what Google shows about the restaurant (hours, menu): always the owner's
// Approve, never Auto and never Draft only, whatever is stored.
export const ALWAYS_APPROVE: ReadonlySet<Task> = new Set<Task>(["hours_update", "menu_update"]);

// Text that offers something (a discount, a freebie, a deal) counts as an offer,
// whatever task it came from, so it can't go out on Auto either.
const OFFER = /\b\d{1,3}\s*%\s*off\b|£\s?\d+(?:\.\d{2})?\s+off\b|\bhalf[-\s]price\b|\bfree\b|\b(?:2|two)\s*(?:for|4)\s*(?:1|one)\b|\bbogof\b|\bbuy\s+one\b|\bdiscount\b/i;
export function looksLikeOffer(text: string) {
  return OFFER.test(text);
}

export function taskFor(kind: string): Task | null {
  return (TASKS as readonly string[]).includes(kind) ? (kind as Task) : null;
}

export function trustLevel(stored: Record<string, string> | null | undefined, task: Task | null): TrustLevel {
  if (!task || ALWAYS_APPROVE.has(task)) return "approve";
  const level = stored?.[task];
  if (!level || !(TRUST_LEVELS as readonly string[]).includes(level)) return "approve";
  if (level === "auto" && NEVER_AUTO.has(task)) return "approve";
  return level as TrustLevel;
}

export type GateDraft = {
  kind: string;
  content: string;
  version?: number;
  approved_at: string | null;
  agent_check?: { mode: string; verdict: string; draft_version: number } | null;
};

// The checker agent passed this exact version, and is live (a shadow verdict never counts).
export function checkerPassed(draft: GateDraft) {
  const c = draft.agent_check;
  return Boolean(c && c.mode === "live" && c.verdict === "pass" && c.draft_version === (draft.version ?? 1));
}

export type Approval =
  | { ok: true; by: "owner" | "auto" }
  | { ok: false; reason: "not_approved" | "trust_level"; detail: string };

// Is this draft approved to go out? The owner's tap, or Auto (never for the
// never-Auto tasks or anything that reads as an offer, and only with a live
// checker pass). A Draft-only task is never sent.
export function gateApproval(draft: GateDraft, stored: Record<string, string> | null | undefined): Approval {
  const task = taskFor(draft.kind);
  const level = trustLevel(stored, task);
  if (level === "draft_only") {
    return { ok: false, reason: "trust_level", detail: `${task ? TASK_LABELS[task] : "This task"} are set to Draft only, so they're never sent.` };
  }
  if (draft.approved_at) return { ok: true, by: "owner" };
  if (level === "auto") {
    if (looksLikeOffer(draft.content)) return { ok: false, reason: "not_approved", detail: "It reads as an offer, and offers are never sent on Auto." };
    if (!checkerPassed(draft)) return { ok: false, reason: "not_approved", detail: "Set to Auto, but the checker hasn't passed this version." };
    return { ok: true, by: "auto" };
  }
  return { ok: false, reason: "not_approved", detail: "Draft hasn't been approved." };
}
