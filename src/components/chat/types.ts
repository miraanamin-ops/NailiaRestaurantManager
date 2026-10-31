// What the web chat draws. Dina's words and the component she asked for come
// from her checked reply (lib/onboarding/dina/reply.ts); what's inside a
// confirmation or summary card always comes from the database, never her words.

// short: a shorter label where space is tight (a WhatsApp button holds 20 characters).
export type ChatOption = { id: string; label: string; short?: string };
// short: the label where space is tight (a WhatsApp button or list row).
export type ChoiceCard = { id: string; title: string; body: string; short?: string };
// The review a set of reply cards answers, shown above them.
export type Quote = { author: string; rating: number; text: string; real: boolean };
// A numbered how-to step with its screenshot; copy: text with a tap-to-copy button (an email address).
export type HowToStep = { n: number; text: string; image: string; copy?: string };

export type ChatComponent =
  | { type: "quick_replies"; options: ChatOption[] }
  | { type: "choice_cards"; cards: ChoiceCard[]; quote?: Quote }
  // Numbered steps with screenshots, a line under them, and the buttons that follow.
  | { type: "steps"; title: string; steps: HowToStep[]; note: string; video: string | null; actions: ChatOption[] }
  // A message to forward to someone else, with a copy button.
  | { type: "forward"; intro: string; text: string }
  // A button that opens a page (e.g. Connect Google).
  | { type: "link"; label: string; href: string; hint: string | null }
  // One dish's suggested allergens to check (marked as suggestions), with its buttons.
  | { type: "dish_check"; dish: string; section: string; suggested: string[]; position: number; total: number; actions: ChatOption[] }
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
