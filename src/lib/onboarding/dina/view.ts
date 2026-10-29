import type { ChatComponent, ChatMessage, ConfirmationData, ProgressData, StepStatus, SummaryData } from "@/components/chat/types";
import { availableSteps, gapsFor, progress, STEP_DEFS, stepState, type FlowState, type FlowStepKey } from "../flow";

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
  restaurant: { owner_name?: string | null; name?: string | null; address?: string | null; cuisine?: string | null };
  state: FlowState;
};

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
export function cardFor(card: string, sources: CardSources): ConfirmationData | null {
  return card === "basics" ? basicsCard(sources) : null;
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
