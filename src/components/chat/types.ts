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
// image: a screenshot (only once real ones exist); link: a button that opens the page the step is on.
export type HowToStep = { n: number; text: string; image?: string; copy?: string; link?: { label: string; href: string } };

export type ChatComponent =
  | { type: "quick_replies"; options: ChatOption[] }
  | { type: "choice_cards"; cards: ChoiceCard[]; quote?: Quote }
  // Numbered steps with screenshots, a line under them, and the buttons that follow.
  | { type: "steps"; title: string; steps: HowToStep[]; note: string; video: string | null; actions: ChatOption[] }
  // A message to forward to someone else, with a copy button.
  | { type: "forward"; intro: string; text: string }
  // A button that opens a page (e.g. Connect Google).
  // continueLabel: opening it (in a new tab) also tells Dina, so the chat carries on (e.g. the QR codes).
  | { type: "link"; label: string; href: string; hint: string | null; continueLabel?: string | null }
  // One dish's suggested allergens to check (marked as suggestions), with its buttons.
  | { type: "dish_check"; dish: string; section: string; suggested: string[]; position: number; total: number; actions: ChatOption[] }
  | { type: "upload"; accept: "photo" | "document" | "spreadsheet" | "any"; multiple: boolean; label: string }
  | { type: "confirmation"; card: ConfirmationData }
  | { type: "summary"; summary: SummaryData }
  // One of setup's questions, drawn by code (lib/onboarding/guide/cards.ts).
  | { type: "question"; card: QuestionCardData }
  // The end of a chapter: everything it saved, each with Change, and "Looks right".
  | { type: "recap"; recap: RecapData };

// swatches: colour codes drawn as dots (a colour choice); body: the longer text under the label (a reply in a tone).
export type QuestionOption = { id: string; label: string; short?: string; body?: string; swatches?: string[] };
export type QuestionCardData = {
  q: string;
  options: QuestionOption[];
  // Several can be picked (each tap toggles).
  multi: boolean;
  // A decision: picking highlights, and nothing is saved until Confirm.
  confirm: boolean;
  // "Skip this question" (moves to the next question; never skips anything else).
  skip: boolean;
  layout: "buttons" | "cards" | "swatches";
  quote?: Quote;
  image?: string | null;
  // A typed answer: the option it belongs to ("Choose my own") and the hint in the box.
  input?: { optionId: string; placeholder: string } | null;
  upload?: { accept: "photo" | "document" | "spreadsheet" | "any"; multiple: boolean; label: string } | null;
  // What's saved now, shown picked (Change on a recap).
  selected?: string[];
  // The allergen grid (owner's call, 7 Nov 2026): dishes down the side, the 14
  // allergens (and dietary tags) along the top, an X in each cell. suggested: a
  // row that is still only the AI's guess (shown as such).
  grid?: { columns: { id: string; label: string; short: string }[]; rows: { id: string; label: string; section: string; marked: string[]; suggested: boolean; unsure: boolean }[] } | null;
  // A link shown on the card (the costs spreadsheet).
  link?: { label: string; href: string } | null;
};

export type RecapRow = { q: string; label: string; value: string; status: "answered" | "skipped"; swatches?: string[] };
export type RecapData = { chapter: string; title: string; rows: RecapRow[]; next: string | null };

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
// chapters: what the owner sees (a chapter groups steps); chapter: the one they're on.
export type ProgressChapter = { key: string; title: string; status: StepStatus; left: string[] };
export type ProgressData = { steps: ProgressStep[]; position: number; total: number; chapters?: ProgressChapter[]; chapter?: { n: number; total: number; title: string; key: string } | null };

// A card the owner checks and corrects ("Is this right?"): label and value rows.
// colour: a colour code, drawn as a swatch next to the value.
export type ConfirmationField = { key: string; label: string; value: string | null; multiline?: boolean; colour?: string };
// image: a picture shown above the rows (the logo on the "Your look" card).
export type ConfirmationData = { title: string; fields: ConfirmationField[]; image?: string | null };

export type SummaryItem = { key: string; title: string; status: StepStatus; detail: string; editHref?: string };
export type SummaryData = {
  done: number;
  total: number;
  items: SummaryItem[];
  // Skipped or half-done steps: what each would unlock.
  locked: { key: string; title: string; unlock: string }[];
  next: string[];
  // Setup finished: the button to the owner's dashboard.
  dashboardHref?: string | null;
  // The go-live screen (7 Nov 2026): each agent, ready or not, and exactly what a
  // held-back one still needs, with where to do it. Nothing is held back silently.
  agents?: { key: string; name: string; ready: boolean; needs: string[]; href?: string }[];
};
