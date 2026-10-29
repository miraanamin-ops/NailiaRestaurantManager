// What the web chat draws. Dina's words and the component she asked for come
// from her checked reply (lib/onboarding/dina/reply.ts); what's inside a
// confirmation or summary card always comes from the database, never her words.

export type ChatOption = { id: string; label: string };
export type ChoiceCard = { id: string; title: string; body: string };

export type ChatComponent =
  | { type: "quick_replies"; options: ChatOption[] }
  | { type: "choice_cards"; cards: ChoiceCard[] }
  | { type: "upload"; accept: "photo" | "document" | "spreadsheet" | "any"; multiple: boolean; label: string }
  | { type: "confirmation"; card: ConfirmationData }
  | { type: "summary"; summary: SummaryData };

export type ChatMessage = {
  id: string;
  role: "dina" | "owner";
  text: string;
  component?: ChatComponent | null;
  // An answered question's buttons stay visible but can't be pressed again.
  answered?: boolean;
};

export type StepStatus = "not_started" | "in_progress" | "done" | "partial" | "skipped" | "waiting";
export type ProgressStep = { key: string; title: string; status: StepStatus };
export type ProgressData = { steps: ProgressStep[]; position: number; total: number };

// A card the owner checks and corrects ("Is this right?"): label and value rows.
export type ConfirmationField = { key: string; label: string; value: string | null; multiline?: boolean };
export type ConfirmationData = { title: string; fields: ConfirmationField[] };

export type SummaryItem = { key: string; title: string; status: StepStatus; detail: string; editHref?: string };
export type SummaryData = {
  done: number;
  total: number;
  items: SummaryItem[];
  // Skipped or half-done steps: what each would unlock.
  locked: { key: string; title: string; unlock: string }[];
  next: string[];
};
