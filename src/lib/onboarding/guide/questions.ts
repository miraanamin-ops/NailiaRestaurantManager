import { availableSteps, stepState, type FlowState, type FlowStatus, type FlowStepKey, type StepState } from "../flow";
import { availableChapters, type ChapterKey } from "./chapters";

// Every question setup asks, in code (owner's plan, 7 Nov 2026). A step is only
// done once each of its questions is answered or skipped on purpose: a tap can
// no longer close a step early, and the AI can no longer forget a question.
// Who asks: "code" questions are cards code sends itself (with Confirm on a
// decision); "dina" questions are the conversations Dina leads (typed answers,
// files, the Google steps), told to her as what to ask next.
// Plain code, unit-tested (tests/guide.test.ts).

export type Level = "essential" | "important";

// What a question is judged on: the restaurant's saved row, the profile fields
// the owner has confirmed (profile_versions), and every step's saved data.
export type Facts = {
  r: Record<string, unknown>;
  confirmed: ReadonlySet<string>;
  state: FlowState;
};

export type Question = {
  id: string;
  step: FlowStepKey;
  level: Level;
  asker: "code" | "dina";
  // A decision: picked, then confirmed (web: a Confirm button; WhatsApp: read back with Confirm).
  decision: boolean;
  // Shown on the chapter's recap card, and in the "what's left" list.
  label: string;
  // Already true from what's saved (e.g. a logo confirmed in settings counts).
  answered: (f: Facts) => boolean;
  // Only asked when this is true (e.g. dish photos only once there's a logo step).
  applies?: (f: Facts) => boolean;
  // What Dina is told to ask, for her questions.
  brief?: string;
};

// Recorded on the question's step: data.q[<id>] = { status, at }. "reask": the
// owner tapped Change on the recap, so it's asked again whatever is saved.
export type QuestionRecord = { status: "answered" | "skipped" | "reask"; at: string };
const recordOf = (s: StepState, id: string) => ((s.data.q ?? {}) as Record<string, QuestionRecord>)[id];

const data = (f: Facts, k: FlowStepKey) => stepState(f.state, k).data as Record<string, unknown>;
const filled = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined);
// A step's own tool said it's done or half done (or did, before setup had questions).
const baseDone = (k: FlowStepKey) => (f: Facts) => {
  const s = stepState(f.state, k);
  return Boolean(s.data._outcome) || Boolean(s.completedAt);
};

const base = (step: FlowStepKey, label: string, brief: string): Question => ({ id: `${step}.base`, step, level: "essential", asker: "dina", decision: false, label, answered: baseDone(step), brief });

export const QUESTIONS: Question[] = [
  base("hello", "Your basics", "the basics (name, restaurant, address, cuisine, owner or manager), then the basics card"),
  base("google", "Google profile", "the Google profile questions and steps"),

  // Chapter 3: your look and voice.
  { id: "look.logo", step: "look", level: "essential", asker: "code", decision: true, label: "Logo", answered: (f) => f.confirmed.has("logo") && filled(f.r.logo_url) },
  { id: "look.colours", step: "look", level: "essential", asker: "code", decision: true, label: "Colours", answered: (f) => f.confirmed.has("colours") },
  {
    id: "look.photos",
    step: "look",
    level: "important",
    asker: "code",
    decision: false,
    label: "Dish photos",
    answered: (f) => (Array.isArray(f.r.photo_library) ? f.r.photo_library.length : 0) >= 3,
  },
  { id: "tone.praise", step: "tone", level: "essential", asker: "code", decision: true, label: "Replies to good reviews", answered: (f) => Boolean((data(f, "tone").picks as Record<string, unknown> | undefined)?.praise) },
  { id: "tone.complaint", step: "tone", level: "essential", asker: "code", decision: true, label: "Replies to bad reviews", answered: (f) => Boolean((data(f, "tone").picks as Record<string, unknown> | undefined)?.complaint) },
  { id: "tone.sign_off", step: "tone", level: "essential", asker: "code", decision: true, label: "How replies are signed", answered: (f) => filled(f.r.sign_off_name) },
  { id: "tone.emoji", step: "tone", level: "essential", asker: "code", decision: true, label: "Emoji", answered: (f) => f.confirmed.has("emoji_allowed") },

  base("menu", "Your menu and allergens", "the menu (photos or PDF, then the menu card), then the allergens"),
  base("rewards", "Rewards and limits", "the sign-up reward and the discount cap"),
  base("make_it_right", "Putting things right", "what may be offered to an unhappy customer, and who handles complaints"),
  base("hours_faqs", "Hours and common questions", "the opening hours (then the hours card), then the common questions one at a time"),
  base("customers_qr", "QR codes", "their QR codes"),
  base("sales", "Sales history", "their sales history"),
  base("team", "Your team", "their team, the site manager, cover rules and labour target"),
  base("languages_dates", "Languages and key dates", "their languages and key dates"),
  base("approvals_timing", "When you hear from me", "the morning brief time and when customers may get messages"),
];

// Each chapter ends with a recap the owner confirms ("Looks right"), held on its last step.
export const recapId = (c: ChapterKey) => `recap.${c}`;
export const isRecap = (id: string) => id.startsWith("recap.");

export function recapQuestion(chapter: ChapterKey, step: FlowStepKey): Question {
  return { id: recapId(chapter), step, level: "important", asker: "code", decision: false, label: "Recap", answered: () => false };
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
export const questionById = (id: string): Question | null => {
  if (isRecap(id)) {
    const c = availableChapters().find((x) => recapId(x.key) === id);
    return c ? recapQuestion(c.key, c.steps[c.steps.length - 1]) : null;
  }
  return byId.get(id) ?? null;
};

// A step's questions in order, the chapter's recap last on its last step.
export function questionsFor(step: FlowStepKey, f: Facts): Question[] {
  const own = QUESTIONS.filter((q) => q.step === step && (!q.applies || q.applies(f)));
  const chapter = availableChapters().find((c) => c.steps.includes(step));
  const last = chapter?.steps[chapter.steps.length - 1];
  return chapter && chapter.recap !== false && last === step ? [...own, recapQuestion(chapter.key, step)] : own;
}

export type Resolution = "answered" | "skipped" | "open";

export function resolution(q: Question, f: Facts): Resolution {
  const rec = recordOf(stepState(f.state, q.step), q.id);
  if (rec?.status === "reask") return "open";
  if (rec?.status === "skipped") return "skipped";
  if (rec?.status === "answered" || q.answered(f)) return "answered";
  return "open";
}

export const openQuestions = (step: FlowStepKey, f: Facts) => questionsFor(step, f).filter((q) => resolution(q, f) === "open");

// The step's status once its questions are counted. A step a tool finished stays
// open while any of its questions is; with all answered, it's done (or half done
// when an essential one was skipped, or its tool said half done). Not started,
// skipped and waiting-on-someone steps are left as they are.
// before: the step as it was, so a step already finished stays finished when it's
// only being looked at or edited (an older setup has no recap record), unless
// one of its questions was sent back to ask again (Change on a recap).
export function gateStep(state: FlowState, key: FlowStepKey, f: Facts, now: string, before?: FlowState): FlowState {
  const s = stepState(state, key);
  if (s.status === "not_started" || s.status === "skipped") return state;
  if (s.status === "in_progress" && s.waitingOn) return state;
  const was = before ? stepState(before, key).status : null;
  const reasked = Object.values((s.data.q ?? {}) as Record<string, QuestionRecord>).some((r) => r.status === "reask");
  if ((was === "done" || was === "partial") && (s.status === "done" || s.status === "partial") && !reasked) return state;
  const facts = { ...f, state };
  const qs = questionsFor(key, facts);
  const open = qs.filter((q) => resolution(q, facts) === "open");
  let status: FlowStatus;
  if (open.length) status = "in_progress";
  else {
    const essentialSkipped = qs.some((q) => q.level === "essential" && resolution(q, facts) === "skipped");
    status = essentialSkipped || s.data._outcome === "partial" ? "partial" : "done";
  }
  if (status === s.status) return state;
  return { ...state, [key]: { ...s, status, completedAt: status === "in_progress" ? s.completedAt : (s.completedAt ?? now) } };
}

// What happens next in setup: the first step not dealt with, and its first open question.
export type NextAction =
  | { kind: "ask"; step: FlowStepKey; question: Question }
  | { kind: "recap"; step: FlowStepKey; chapter: ChapterKey }
  | { kind: "dina"; step: FlowStepKey; question: Question | null }
  | { kind: "end" };

const resolved = (s: StepState) => ["done", "partial", "skipped"].includes(s.status) || (s.status === "in_progress" && s.waitingOn !== null);

export function nextAction(f: Facts, steps: FlowStepKey[] = availableSteps()): NextAction {
  const step = steps.find((k) => !resolved(stepState(f.state, k)));
  if (!step) return { kind: "end" };
  const q = openQuestions(step, f)[0] ?? null;
  if (!q) return { kind: "dina", step, question: null };
  if (isRecap(q.id)) return { kind: "recap", step, chapter: q.id.slice("recap.".length) as ChapterKey };
  return q.asker === "code" ? { kind: "ask", step, question: q } : { kind: "dina", step, question: q };
}

// Recording an answer or a skip on the question's step data.
export function withRecord(stepData: Record<string, unknown>, id: string, status: QuestionRecord["status"], at: string) {
  const q = { ...((stepData.q ?? {}) as Record<string, QuestionRecord>), [id]: { status, at } };
  return { ...stepData, q };
}

// Asking a question again (Change on the recap): it's marked to ask again, and
// the chapter's recap waits for a fresh "Looks right" (that record is on the
// chapter's last step, which may be another step: reopenRecap).
export function withReask(stepData: Record<string, unknown>, id: string, at: string) {
  return withRecord(stepData, id, "reask", at);
}
export function withoutRecord(stepData: Record<string, unknown>, id: string) {
  const q = { ...((stepData.q ?? {}) as Record<string, QuestionRecord>) };
  delete q[id];
  return { ...stepData, q };
}
