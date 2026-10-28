// Onboarding with Dina: the steps, their order, what each unlocks, and every
// rule about where the owner is. Plain code with no imports, so it's unit-tested
// (tests/onboarding-flow.test.ts). Dina only talks: a step's status changes here,
// after a tool call that code has checked (never because the AI says so).
// The web chat and WhatsApp both run on this, so they always agree.

export const FLOW_STEPS = [
  "hello",
  "google",
  "tone",
  "make_it_right",
  "menu",
  "hours_faqs",
  "sales",
  "team",
  "rewards",
  "customers_qr",
  "languages_dates",
  "approvals_timing",
] as const;
export type FlowStepKey = (typeof FLOW_STEPS)[number];

export type FlowStatus = "not_started" | "in_progress" | "done" | "partial" | "skipped";

export type StepDef = {
  key: FlowStepKey;
  title: string;
  skippable: boolean;
  // One line on what the step unlocks, used by Dina and by setup gaps (null: never a gap).
  unlock: string | null;
  // Which gap Dina raises first (lower first); the rest follow the step order.
  gapPriority: number;
  // Not built yet: left out of the flow (the progress bar, the order, finishing).
  available: boolean;
};

const step = (key: FlowStepKey, title: string, unlock: string | null, opts: { gapPriority?: number; available?: boolean } = {}): StepDef => ({
  key,
  title,
  skippable: unlock !== null,
  unlock,
  gapPriority: opts.gapPriority ?? 10 + FLOW_STEPS.indexOf(key),
  available: opts.available ?? true,
});

// Steps 7 to 12 come in milestone B and C (docs/onboarding-audit.md): until then
// their safe defaults apply and they aren't asked.
export const STEP_DEFS: Record<FlowStepKey, StepDef> = {
  hello: step("hello", "Hello", null),
  google: step("google", "Google profile", "Connect Google and I'll reply to your reviews, post updates and track calls and directions for you.", { gapPriority: 1 }),
  tone: step("tone", "Your tone", "Pick a tone and every reply and post will sound like you."),
  make_it_right: step("make_it_right", "Making it right", "Tell me how you like to fix complaints and I'll offer it in replies to unhappy customers."),
  menu: step("menu", "Your menu", "Share your menu and I'll write captions, suggest offers and answer allergen questions using your real dishes.", { gapPriority: 3 }),
  hours_faqs: step("hours_faqs", "Hours and FAQs", "Confirm your hours and FAQs and I'll keep Google accurate and answer common questions."),
  sales: step("sales", "Sales history", "Send your sales history and I'll forecast quiet nights and plan offers before they happen.", { gapPriority: 2, available: false }),
  team: step("team", "Team and labour", "Share your team and labour target and I'll track labour % daily and suggest rotas.", { available: false }),
  rewards: step("rewards", "Rewards and limits", "Set your rewards and limits and I'll run offers without ever going over budget.", { available: false }),
  customers_qr: step("customers_qr", "Customers and QR codes", "Import your customers and print your QR codes and I'll start growing your list.", { available: false }),
  languages_dates: step("languages_dates", "Languages and key dates", "Tell me your languages and key dates and I'll plan campaigns around them.", { available: false }),
  approvals_timing: step("approvals_timing", "Approvals and timing", "Tell me who approves and when to message you, and I’ll fit around your day.", { available: false }),
};

export const isFlowStep = (key: string): key is FlowStepKey => (FLOW_STEPS as readonly string[]).includes(key);

export function availableSteps(defs: Record<FlowStepKey, StepDef> = STEP_DEFS): FlowStepKey[] {
  return FLOW_STEPS.filter((k) => defs[k].available);
}

export type StepState = {
  status: FlowStatus;
  data: Record<string, unknown>;
  waitingOn: string | null; // in progress, but waiting on someone else (e.g. Google accepting our invite)
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
};
export type FlowState = Partial<Record<FlowStepKey, StepState>>;

const EMPTY: StepState = { status: "not_started", data: {}, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null };

export const stepState = (state: FlowState, key: FlowStepKey): StepState => state[key] ?? EMPTY;
export const statusOf = (state: FlowState, key: FlowStepKey): FlowStatus => stepState(state, key).status;

// Dealt with for now: Dina moves on. A step waiting on someone else counts, so the
// owner isn't stuck while Google accepts an invite.
export function isResolved(s: StepState) {
  return s.status === "done" || s.status === "partial" || s.status === "skipped" || (s.status === "in_progress" && s.waitingOn !== null);
}

// The step Dina is on: the first one not dealt with (null = all are).
export function currentStep(state: FlowState, defs = STEP_DEFS): FlowStepKey | null {
  return availableSteps(defs).find((k) => !isResolved(stepState(state, k))) ?? null;
}

// For the progress bar ("Setup 4 of 6") and the summary ("4 of 6 done").
export function progress(state: FlowState, defs = STEP_DEFS) {
  const steps = availableSteps(defs);
  const current = currentStep(state, defs);
  return {
    total: steps.length,
    position: current ? steps.indexOf(current) + 1 : steps.length,
    done: steps.filter((k) => statusOf(state, k) === "done").length,
    resolved: steps.filter((k) => isResolved(stepState(state, k))).length,
  };
}

export class FlowError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "not_skippable" | "already_done",
  ) {
    super(message);
    this.name = "FlowError";
  }
}

function mustBeAvailable(key: FlowStepKey, defs: Record<FlowStepKey, StepDef>) {
  if (!defs[key].available) throw new FlowError(`${defs[key].title} isn't part of setup yet`, "unavailable");
}

const put = (state: FlowState, key: FlowStepKey, s: StepState): FlowState => ({ ...state, [key]: s });

// The owner goes to a step (in order, by jumping back, or to fix something).
// A finished step stays finished while it's edited; its new data still has to
// pass the same checks. A step waiting on someone keeps waiting.
export function enter(state: FlowState, key: FlowStepKey, now: string, defs = STEP_DEFS): FlowState {
  mustBeAvailable(key, defs);
  const s = stepState(state, key);
  if (s.status === "done" || (s.status === "in_progress" && s.waitingOn)) return state;
  return put(state, key, { ...s, status: "in_progress", startedAt: s.startedAt ?? now, skippedAt: null });
}

// Checked data saved for a step: everything it needs (done) or only some (partial).
// Whether it's done or partial is the tool's checked verdict, never the AI's.
export function complete(state: FlowState, key: FlowStepKey, outcome: "done" | "partial", data: Record<string, unknown>, now: string, defs = STEP_DEFS): FlowState {
  mustBeAvailable(key, defs);
  const s = stepState(state, key);
  return put(state, key, {
    status: outcome,
    data: { ...s.data, ...data },
    waitingOn: null,
    startedAt: s.startedAt ?? now,
    completedAt: now,
    skippedAt: null,
  });
}

// Saved what the owner can do; the rest is up to someone else (e.g. Google).
export function wait(state: FlowState, key: FlowStepKey, waitingOn: string, data: Record<string, unknown>, now: string, defs = STEP_DEFS): FlowState {
  mustBeAvailable(key, defs);
  const s = stepState(state, key);
  if (s.status === "done") throw new FlowError(`${defs[key].title} is already done`, "already_done");
  return put(state, key, { ...s, status: "in_progress", data: { ...s.data, ...data }, waitingOn, startedAt: s.startedAt ?? now, skippedAt: null });
}

// "Skip for now". Hello can't be skipped; a finished step stays finished.
export function skip(state: FlowState, key: FlowStepKey, now: string, defs = STEP_DEFS): FlowState {
  mustBeAvailable(key, defs);
  if (!defs[key].skippable) throw new FlowError(`${defs[key].title} can't be skipped`, "not_skippable");
  const s = stepState(state, key);
  if (s.status === "done") return state;
  return put(state, key, { ...s, status: "skipped", waitingOn: null, skippedAt: now });
}

// Nothing runs for a restaurant (brief, review checks, report) before step 1 is done.
export const canActivate = (state: FlowState) => statusOf(state, "hello") === "done";

// Finishing: Hello done, every step dealt with, and the owner's WhatsApp linked
// (the morning brief lives there).
export function canFinish(state: FlowState, whatsappLinked: boolean, defs = STEP_DEFS) {
  return canActivate(state) && whatsappLinked && currentStep(state, defs) === null;
}

// ---------- Setup gaps ----------

export type Gap = {
  id: string;
  step_key: string;
  unlock_text: string;
  nudge_count: number;
  last_nudged_at: string | null;
  snoozed_until: string | null;
  dismissed: boolean;
  dismissed_reason: "not_relevant" | "ignored" | null;
  resolved_at: string | null;
};

export const MAX_IGNORED_NUDGES = 3;
export const SNOOZE_DAYS = 7;

// Every skipped or half-done step is a gap, with its unlock line.
export function gapsFor(state: FlowState, defs = STEP_DEFS) {
  return availableSteps(defs)
    .filter((k) => defs[k].unlock && ["skipped", "partial"].includes(statusOf(state, k)))
    .map((k) => ({ step_key: k, unlock_text: defs[k].unlock! }));
}

// What to change in the saved gaps after a step changed: new gaps to add, and
// open gaps whose step is now done (or is being done again) to close. A gap the
// owner dismissed stays dismissed; skipping the same step again doesn't bring it back.
export function syncGaps(saved: Pick<Gap, "id" | "step_key" | "resolved_at">[], state: FlowState, defs = STEP_DEFS) {
  const wanted = new Set<string>(gapsFor(state, defs).map((g) => g.step_key));
  const byStep = new Map(saved.map((g) => [g.step_key, g]));
  return {
    add: gapsFor(state, defs).filter((g) => !byStep.has(g.step_key)),
    reopen: saved.filter((g) => g.resolved_at && wanted.has(g.step_key)).map((g) => g.id),
    resolve: saved.filter((g) => !g.resolved_at && !wanted.has(g.step_key)).map((g) => g.id),
  };
}

const open = (g: Gap) => !g.dismissed && !g.resolved_at;

// The one gap worth a nudge now (at most one a day, in the brief), by value:
// Google, sales history, menu, then the rest in step order. Gaps nudged
// MAX_IGNORED_NUDGES times without an answer are dismissed instead.
export function pickNudge(gaps: Gap[], now: Date, defs = STEP_DEFS) {
  const autoDismiss = gaps.filter((g) => open(g) && g.nudge_count >= MAX_IGNORED_NUDGES).map((g) => g.id);
  const priority = (g: Gap) => (isFlowStep(g.step_key) ? defs[g.step_key].gapPriority : 99);
  const pick =
    gaps
      .filter((g) => open(g) && !autoDismiss.includes(g.id) && (!g.snoozed_until || new Date(g.snoozed_until) <= now))
      .filter((g) => isFlowStep(g.step_key) && defs[g.step_key].available)
      .sort((a, b) => priority(a) - priority(b))[0] ?? null;
  return { pick, autoDismiss };
}

export type GapReply = "now" | "later" | "not_relevant";

// The owner answered a nudge. Any answer means it wasn't ignored.
//   now           -> carry on with that step, here
//   later         -> not again for SNOOZE_DAYS
//   not_relevant  -> never again
export function gapReply(gap: Gap, reply: GapReply, now: Date): { gap: Gap; resume: FlowStepKey | null } {
  const answered = { ...gap, nudge_count: 0 };
  if (reply === "later") return { gap: { ...answered, snoozed_until: new Date(now.getTime() + SNOOZE_DAYS * 86_400_000).toISOString() }, resume: null };
  if (reply === "not_relevant") return { gap: { ...answered, dismissed: true, dismissed_reason: "not_relevant" }, resume: null };
  return { gap: answered, resume: isFlowStep(gap.step_key) ? gap.step_key : null };
}
