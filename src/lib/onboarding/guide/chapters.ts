import { availableSteps, STEP_DEFS, type FlowStepKey } from "../flow";

// The chapters an owner goes through (owner's plan, 7 Nov 2026): a fixed order
// that runs from who you are, to how you come across, to what you sell and what
// it earns, to how you work. A chapter groups steps (the steps hold the saved
// data); the owner sees chapters. Plain code, unit-tested (tests/guide.test.ts).

export const CHAPTER_KEYS = ["restaurant", "google", "look_voice", "menu", "offers", "customers", "sales_team", "calendar", "working"] as const;
export type ChapterKey = (typeof CHAPTER_KEYS)[number];

export type ChapterDef = {
  key: ChapterKey;
  title: string;
  // What the chapter covers, for its opening line ("about 4 minutes: ...").
  covers: string;
  minutes: number;
  steps: FlowStepKey[];
  // Ends with a recap to confirm. Not Google: it finishes on Google's side, often
  // much later, and code says so when it does ("I'm in!").
  recap?: false;
};

export const CHAPTERS: Record<ChapterKey, ChapterDef> = {
  restaurant: { key: "restaurant", title: "You and your restaurant", covers: "your basics", minutes: 4, steps: ["hello"] },
  google: { key: "google", title: "Google", covers: "giving us access to your Google profile", minutes: 2, steps: ["google"], recap: false },
  look_voice: { key: "look_voice", title: "Your look and voice", covers: "your logo, your colours, your tone and how you sign off", minutes: 4, steps: ["look", "tone"] },
  menu: { key: "menu", title: "Your menu and margins", covers: "your dishes, prices and allergens", minutes: 6, steps: ["menu"] },
  offers: { key: "offers", title: "Offers and limits", covers: "your sign-up reward and the limits on every offer", minutes: 2, steps: ["rewards"] },
  customers: { key: "customers", title: "Customers and complaints", covers: "putting things right, your hours and common questions, and your QR codes", minutes: 4, steps: ["make_it_right", "hours_faqs", "customers_qr"] },
  sales_team: { key: "sales_team", title: "Sales and team", covers: "your sales history and your team", minutes: 4, steps: ["sales", "team"] },
  calendar: { key: "calendar", title: "Your calendar", covers: "your customers' languages and the dates that matter", minutes: 2, steps: ["languages_dates"] },
  working: { key: "working", title: "Working together", covers: "when you hear from me and when customers can", minutes: 2, steps: ["approvals_timing"] },
};

// Chapters that have at least one step built (a chapter with none isn't shown).
export function availableChapters(steps: FlowStepKey[] = availableSteps()): ChapterDef[] {
  return CHAPTER_KEYS.map((k) => ({ ...CHAPTERS[k], steps: CHAPTERS[k].steps.filter((s) => steps.includes(s)) })).filter((c) => c.steps.length);
}

export function chapterOf(step: FlowStepKey): ChapterDef | null {
  return availableChapters().find((c) => c.steps.includes(step)) ?? null;
}

// "Chapter 3 of 9: Your look and voice"
export function chapterLabel(step: FlowStepKey) {
  const chapters = availableChapters();
  const c = chapters.find((x) => x.steps.includes(step));
  return c ? `Chapter ${chapters.indexOf(c) + 1} of ${chapters.length}: ${c.title}` : STEP_DEFS[step].title;
}

// The line that opens a chapter (code's words, so it passes Dina's checks).
export function chapterIntro(c: ChapterDef) {
  const chapters = availableChapters();
  return `Chapter ${chapters.findIndex((x) => x.key === c.key) + 1} of ${chapters.length}: ${c.title}. About ${c.minutes} minutes on ${c.covers}.`;
}

// Every chapter's steps appear in the flow in chapter order (a test checks it).
export const chapterOrder = () => availableChapters().flatMap((c) => c.steps);
