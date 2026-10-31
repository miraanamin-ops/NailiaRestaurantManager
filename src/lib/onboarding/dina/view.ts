import type { ChatComponent, ChatMessage, ConfirmationData, ProgressData, StepStatus, SummaryData } from "@/components/chat/types";
import { availableSteps, gapsFor, progress, STEP_DEFS, stepState, type FlowState, type FlowStepKey } from "../flow";
import { forwardMessage, managerSteps, REASSURANCE, SIGN_IN_HINT, VIDEO_SLOT } from "./google-content";
import { defaultOptions, toneCards, type ToneConfig, type ToneOptions, type Voice } from "./tones";
import { allergenProgress, dishKey, hoursCard, menuCard } from "./facts-content";
import type { Hours, MenuCategory } from "../profile-data";

// What the web chat draws, made from what's saved: the conversation (with which
// question each tap answered), the step list, and the cards. Plain code, so it's
// unit-tested (tests/dina-chat.test.ts). Used for the first load of the page and
// for every message streamed after a turn, so both always look the same.
// What a card shows comes from the restaurant's saved details, never from Dina's words.

export type StoredMessage = { id: string; role: "dina" | "owner" | "system"; body: string; parts: unknown[] | null };

// An owner message that answered a button or card: { type: "answer", to: <message id>, choice: <option id> }.
export type AnswerPart = { type: "answer"; to: string; choice: string };
const isAnswer = (p: unknown): p is AnswerPart => typeof p === "object" && p !== null && (p as AnswerPart).type === "answer" && typeof (p as AnswerPart).to === "string";

export type CardSources = {
  restaurant: { owner_name?: string | null; name?: string | null; address?: string | null; cuisine?: string | null; opening_hours?: Record<string, string> | null; menu?: MenuCategory[] | null };
  state: FlowState;
  // For the Google and tone cards (chat.ts fills these in): our manager email,
  // where "Connect Google" goes (null while Path A is off), the tone config.
  setup?: { managerEmail: string | null; googleConnectHref: string | null; tones: ToneConfig };
};

export const GOOGLE_ACTIONS = { invited: "invited", emailSteps: "email_steps" } as const;
export const QUEUE_ACTIONS = { yes: "queue_yes", no: "queue_no" } as const;
export const ALLERGEN_ACTIONS = { ok: "allergen_ok", change: "allergen_change", unsure: "allergen_unsure", later: "allergen_later" } as const;
const NO_MANAGER_EMAIL = "our manager email (being set up: ask the DinerAI team)";

// The review and replies the owner picks a tone from: prepared ones (real reviews)
// kept on the tone step, else the defaults.
export function toneOptionsFor(sources: CardSources, voice: Voice): ToneOptions | null {
  const prepared = (stepState(sources.state, "tone").data.options as Partial<Record<Voice, ToneOptions>> | undefined)?.[voice];
  return prepared ?? (sources.setup ? defaultOptions(sources.setup.tones, voice) : null);
}

// "Your basics": what Hello confirms. Until Hello is done, what the owner has said
// so far (the draft Dina noted through her checked tool) shows over what's saved,
// so they check what they just told her; once done, only what's saved.
export function basicsCard({ restaurant, state }: CardSources): ConfirmationData {
  const hello = stepState(state, "hello");
  const draft = (hello.status === "done" ? {} : (hello.data.draft ?? {})) as Partial<Record<"owner_name" | "restaurant_name" | "address" | "cuisine" | "role", string>>;
  const role = draft.role ?? hello.data.role;
  return {
    title: "Your basics",
    fields: [
      { key: "owner_name", label: "Your name", value: draft.owner_name ?? restaurant.owner_name ?? null },
      { key: "name", label: "Restaurant", value: draft.restaurant_name ?? restaurant.name ?? null },
      { key: "address", label: "Address", value: draft.address ?? restaurant.address ?? null },
      { key: "cuisine", label: "Cuisine", value: draft.cuisine ?? restaurant.cuisine ?? null },
      { key: "role", label: "Your role", value: role === "owner" ? "Owner" : role === "manager" ? "Manager" : null },
    ],
  };
}

// The cards built so far. A card for a step that isn't built yet shows nothing.
// Menu: the draft being checked, else the saved menu. Hours: the draft, else what's saved.
export function cardFor(card: string, sources: CardSources): ConfirmationData | null {
  if (card === "basics") return basicsCard(sources);
  if (card === "menu") {
    const data = stepState(sources.state, "menu").data as { draft?: MenuCategory[] | null; unsure?: Record<string, string> };
    const menu = data.draft ?? sources.restaurant.menu ?? [];
    return menu.length ? menuCard(menu, data.draft ? (data.unsure ?? {}) : {}) : null;
  }
  if (card === "hours") {
    const draft = stepState(sources.state, "hours_faqs").data.hours_draft as Hours | undefined;
    return hoursCard(draft ?? ((sources.restaurant.opening_hours ?? {}) as Hours));
  }
  return null;
}

// An allergen card: the dish it was saved with, as the menu holds it now.
function dishCheck(dishKeyValue: string | undefined, sources: CardSources): ChatComponent | null {
  const menu = sources.restaurant.menu ?? [];
  for (const c of menu)
    for (const i of c.items)
      if (dishKey(c.category, i.name) === dishKeyValue) {
        const notSure = (stepState(sources.state, "menu").data.not_sure as string[] | undefined) ?? [];
        const p = allergenProgress(menu, notSure);
        const position = menu.flatMap((x) => x.items.map((y) => dishKey(x.category, y.name))).indexOf(dishKeyValue) + 1;
        return {
          type: "dish_check",
          dish: i.name,
          section: c.category,
          suggested: i.allergens ?? [],
          position,
          total: p.total,
          actions: [
            { id: ALLERGEN_ACTIONS.ok, label: "That's right" },
            { id: ALLERGEN_ACTIONS.change, label: "Change it" },
            { id: ALLERGEN_ACTIONS.unsure, label: "Not sure" },
            { id: ALLERGEN_ACTIONS.later, label: "Do the rest later", short: "Rest later" },
          ],
        };
      }
  return null;
}

const SUMMARY_DETAIL: Partial<Record<FlowStepKey, (s: CardSources) => string>> = {
  hello: ({ restaurant }) => [restaurant.name, restaurant.cuisine, restaurant.address].filter(Boolean).join(", "),
};

export function summaryFrom(sources: CardSources): SummaryData {
  const steps = availableSteps();
  const items = steps
    .filter((k) => ["done", "partial"].includes(stepState(sources.state, k).status))
    .map((k) => {
      const status = stepState(sources.state, k).status as "done" | "partial";
      return { key: k, title: STEP_DEFS[k].title, status, detail: SUMMARY_DETAIL[k]?.(sources) || (status === "done" ? "Done" : "Half done") };
    });
  return {
    done: steps.filter((k) => stepState(sources.state, k).status === "done").length,
    total: steps.length,
    items,
    locked: gapsFor(sources.state).map((g) => ({ key: g.step_key, title: STEP_DEFS[g.step_key].title, unlock: g.unlock_text })),
    next: ["Your first morning brief arrives on WhatsApp the morning after you finish.", "Your Monday report comes on Monday morning.", "Your QR codes will be ready to print."],
  };
}

function component(part: unknown, sources: CardSources): ChatComponent | null {
  if (typeof part !== "object" || part === null) return null;
  const p = part as { type?: string; card?: string };
  if (p.type === "quick_replies" || p.type === "choice_cards" || p.type === "upload") return part as ChatComponent;
  if (p.type === "editable_card") {
    const card = cardFor(p.card ?? "", sources);
    return card ? { type: "confirmation", card } : null;
  }
  if (p.type === "summary") return { type: "summary", summary: summaryFrom(sources) };
  const setup = sources.setup;
  const email = setup?.managerEmail ?? NO_MANAGER_EMAIL;
  if (p.type === "google_steps") {
    const device = (part as { device?: string }).device === "laptop" ? "laptop" : "phone";
    return {
      type: "steps",
      title: "Adding DinerAI on Google",
      steps: managerSteps(device, email),
      note: REASSURANCE,
      video: VIDEO_SLOT[device],
      actions: [
        { id: GOOGLE_ACTIONS.invited, label: "Done, I've invited you", short: "Done, invited you" },
        { id: GOOGLE_ACTIONS.emailSteps, label: "Email me these steps", short: "Email me the steps" },
      ],
    };
  }
  if (p.type === "google_forward") return { type: "forward", intro: "Forward this to whoever set up your Google profile:", text: forwardMessage(sources.restaurant.name ?? "the restaurant", email) };
  if (p.type === "google_connect") return setup?.googleConnectHref ? { type: "link", label: "Connect Google", href: setup.googleConnectHref, hint: SIGN_IN_HINT } : null;
  if (p.type === "tone_choices" && setup) {
    const voice: Voice = (part as { voice?: string }).voice === "complaint" ? "complaint" : "praise";
    const options = toneOptionsFor(sources, voice)!;
    return { type: "choice_cards", quote: { ...options.review, real: options.real }, cards: toneCards(setup.tones, options) };
  }
  if (p.type === "allergen_check") return dishCheck((part as { dish?: string }).dish, sources);
  if (p.type === "queue_replies")
    return {
      type: "quick_replies",
      options: [
        { id: QUEUE_ACTIONS.yes, label: "Queue my replies" },
        { id: QUEUE_ACTIONS.no, label: "No thanks" },
      ],
    };
  return null;
}

export function chatMessage(row: StoredMessage, sources: CardSources): ChatMessage {
  return { id: row.id, role: row.role === "owner" ? "owner" : "dina", text: row.body, component: row.role === "dina" ? component(row.parts?.[0], sources) : null };
}

// The whole conversation, oldest first. A question with buttons counts as answered
// once the owner has said anything after it; a tap's choice stays highlighted.
export function chatFrom(rows: StoredMessage[], sources: CardSources) {
  const shown = rows.filter((r) => r.role !== "system");
  const lastOwner = shown.map((r) => r.role).lastIndexOf("owner");
  const chosen: Record<string, string> = {};
  for (const r of shown) for (const p of r.parts ?? []) if (isAnswer(p)) chosen[p.to] = p.choice;
  const messages = shown.map((r, i) => ({ ...chatMessage(r, sources), answered: r.role === "dina" && i < lastOwner }));
  return { messages, chosen };
}

const STATUS: Record<string, StepStatus> = { not_started: "not_started", in_progress: "in_progress", done: "done", partial: "partial", skipped: "skipped" };

// The step list. focus: the step the owner is on (it may be a finished one being changed).
export function progressFrom(state: FlowState, focus: FlowStepKey | null): ProgressData {
  const steps = availableSteps();
  const p = progress(state);
  return {
    total: p.total,
    position: focus && steps.includes(focus) ? steps.indexOf(focus) + 1 : p.position,
    steps: steps.map((k) => {
      const s = stepState(state, k);
      const status: StepStatus = s.status === "in_progress" && s.waitingOn ? "waiting" : k === focus && s.status !== "done" ? "in_progress" : STATUS[s.status];
      return { key: k, title: STEP_DEFS[k].title, status };
    }),
  };
}

export const skippableNow = (focus: FlowStepKey | null) => Boolean(focus && STEP_DEFS[focus].skippable && STEP_DEFS[focus].available);

// What a confirmation card's changes say to Dina, in the owner's words.
export function confirmText(card: ConfirmationData | null, changes: Record<string, string>) {
  const entries = Object.entries(changes);
  if (!entries.length) return "Looks right";
  const label = (k: string) => card?.fields.find((f) => f.key === k)?.label ?? k;
  return `Please change these: ${entries.map(([k, v]) => `${label(k)}: ${v || "(blank)"}`).join("; ")}`;
}
