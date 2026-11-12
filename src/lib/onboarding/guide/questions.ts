import { availableSteps, stepState, type FlowState, type FlowStatus, type FlowStepKey, type StepState } from "../flow";
import { availableChapters, type ChapterKey } from "./chapters";
import { catalogById } from "./catalog";

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

// A catalog question (guide/catalog.ts): code's own, answered only by the owner's answer.
const fromCatalog = (id: string): Question => {
  const c = catalogById.get(id);
  if (!c) throw new Error(`No catalog question ${id}`);
  return { id, step: c.step, level: c.level, asker: "code", decision: c.decision, label: c.label, answered: () => false, applies: c.applies };
};
const code = (q: Omit<Question, "asker">): Question => ({ ...q, asker: "code" });
const menuItems = (f: Facts) => ((f.r.menu ?? []) as { items?: { cost?: number | null; seller?: string | null; signature?: boolean; allergens_confirmed?: boolean }[] }[]).flatMap((c) => c.items ?? []);
const hasMenu = (f: Facts) => menuItems(f).length > 0;
const rotaImport = (f: Facts) => data(f, "team").rota_import as { shifts?: unknown[]; confirmed?: boolean } | null | undefined;
// The team is saved (Looks right on the team card) with at least one person on it.
const teamSaved = (f: Facts) => Number(data(f, "team").staff ?? 0) > 0;
const menuSaved = (f: Facts) => {
  const s = stepState(f.state, "menu");
  return Boolean(s.data.saved_at) || Boolean(s.data._outcome) || Boolean(s.completedAt);
};

export const QUESTIONS: Question[] = [
  // Chapter 1: you and your restaurant. Dina confirms the basics; code asks the rest.
  base("hello", "Your basics", "the basics (name, restaurant, address, cuisine, owner or manager), then the basics card"),
  ...["restaurant.phone", "restaurant.website", "restaurant.venue", "restaurant.seats", "restaurant.spend", "restaurant.customers", "restaurant.instagram", "restaurant.ordering", "restaurant.booking", "restaurant.goals"].map(fromCatalog),

  // Chapter 2: Google.
  base("google", "Google profile", "the Google profile questions and steps"),

  // Chapter 3: your look and voice.
  code({ id: "look.logo", step: "look", level: "essential", decision: true, label: "Logo", answered: (f) => f.confirmed.has("logo") && filled(f.r.logo_url) }),
  code({ id: "look.colours", step: "look", level: "essential", decision: true, label: "Colours", answered: (f) => f.confirmed.has("colours") }),
  code({ id: "look.photos", step: "look", level: "important", decision: false, label: "Dish photos", answered: (f) => (Array.isArray(f.r.photo_library) ? f.r.photo_library.length : 0) >= 3 }),
  code({ id: "tone.praise", step: "tone", level: "essential", decision: true, label: "Replies to good reviews", answered: (f) => Boolean((data(f, "tone").picks as Record<string, unknown> | undefined)?.praise) }),
  code({ id: "tone.complaint", step: "tone", level: "essential", decision: true, label: "Replies to bad reviews", answered: (f) => Boolean((data(f, "tone").picks as Record<string, unknown> | undefined)?.complaint) }),
  code({ id: "tone.sign_off", step: "tone", level: "essential", decision: true, label: "How replies are signed", answered: (f) => filled(f.r.sign_off_name) }),
  code({ id: "tone.emoji", step: "tone", level: "essential", decision: true, label: "Emoji", answered: (f) => f.confirmed.has("emoji_allowed") }),

  // Chapter 4: your menu and margins. Dina reads the menu; code asks the rest.
  { ...base("menu", "Your menu", "the menu (photos or PDF, then the menu card)"), answered: menuSaved },
  code({ id: "menu.allergens", step: "menu", level: "essential", decision: true, label: "Allergens", answered: () => false, applies: hasMenu }),
  { ...fromCatalog("menu.allergen_statement"), applies: hasMenu },
  code({ id: "menu.costs", step: "menu", level: "important", decision: true, label: "Dish costs", answered: (f) => menuItems(f).some((i) => typeof i.cost === "number"), applies: hasMenu }),
  code({ id: "menu.top", step: "menu", level: "important", decision: true, label: "Best sellers", answered: () => false, applies: hasMenu }),
  code({ id: "menu.slow", step: "menu", level: "important", decision: true, label: "Slowest sellers", answered: () => false, applies: hasMenu }),
  code({ id: "menu.signature", step: "menu", level: "important", decision: true, label: "Signature dishes", answered: () => false, applies: hasMenu }),

  // Chapter 5: offers and limits (after the dish costs, so the minimum profit means something).
  ...["offers.reward", "offers.birthday", "offers.types", "offers.cap", "offers.margin", "offers.no_discount"].map(fromCatalog),

  // Chapter 6: customers and complaints.
  base("make_it_right", "Putting things right", "what may be offered to an unhappy customer, who handles complaints and how customers reach them"),
  base("hours_faqs", "Hours and common questions", "the opening hours (then the hours card), then the common questions one at a time"),
  code({ id: "customers.qr", step: "customers_qr", level: "essential", decision: false, label: "QR codes", answered: (f) => Boolean(data(f, "customers_qr").qr_sent_at) }),
  code({ id: "customers.import", step: "customers_qr", level: "important", decision: false, label: "Your customer list", answered: () => false }),
  code({ id: "customers.consent", step: "customers_qr", level: "essential", decision: true, label: "How they agreed", answered: () => false, applies: (f) => Boolean(data(f, "customers_qr").import_draft) }),

  // Chapter 7: sales and team.
  base("sales", "Sales history", "their sales history"),
  ...["sales.target", "sales.quiet", "sales.busy"].map(fromCatalog),
  // Their last few weeks of rotas first (owner's plan, 12 Nov 2026): learnt from against the same days' sales.
  code({ id: "team.rotas", step: "team", level: "important", decision: false, label: "Your recent rotas", answered: (f) => Boolean(data(f, "team").rota_import) || Boolean(data(f, "team")._outcome) }),
  code({ id: "team.rotas_check", step: "team", level: "important", decision: true, label: "Rotas read", answered: (f) => Boolean(rotaImport(f)?.confirmed), applies: (f) => Boolean(rotaImport(f)?.shifts?.length) }),
  code({ id: "team.method", step: "team", level: "important", decision: false, label: "How you'll send your team", answered: (f) => Boolean(data(f, "team").staff_files) || Boolean(data(f, "team").team_draft) || Boolean(data(f, "team")._outcome) }),
  base(
    "team",
    "Your team",
    "their team (from the sheet or file they sent, the people on their rotas, or in their own words: name, main role, anything else they can do, hourly rate, contracted hours, when each person can work, and who can open up and lock up), then the site manager",
  ),
  // Then code's own: how many people they need (suggested for their size, or learnt from their rotas), and the labour target.
  code({ id: "team.staffing", step: "team", level: "important", decision: true, label: "How many people you need", answered: () => false, applies: teamSaved }),
  code({ id: "team.labour", step: "team", level: "important", decision: true, label: "Labour target", answered: () => false, applies: teamSaved }),

  // Chapter 8: your calendar.
  ...["calendar.languages", "calendar.dates", "calendar.closures"].map(fromCatalog),

  // Chapter 9: working together.
  fromCatalog("working.brief"),
  code({ id: "working.window", step: "approvals_timing", level: "essential", decision: true, label: "When customers can hear from you", answered: () => false }),
  code({ id: "working.quiet", step: "approvals_timing", level: "essential", decision: true, label: "When I won't message you", answered: () => false }),
  ...["working.language", "working.style"].map(fromCatalog),
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

const resolved = (s: StepState) => ["done", "partial", "skipped"].includes(s.status) || (s.status === "in_progress" && Boolean(s.waitingOn));

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
