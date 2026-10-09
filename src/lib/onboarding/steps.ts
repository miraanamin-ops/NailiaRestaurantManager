// The onboarding steps and what "done" means. Plain code with no imports, so
// it's unit-tested (tests/onboarding.test.ts). The web wizard and WhatsApp both
// use this, so they always agree on where the owner is.

export const STEPS = ["google", "menu", "allergens", "voice", "reward", "finish"] as const;
export type StepId = (typeof STEPS)[number];

export const STEP_LABELS: Record<StepId, string> = {
  google: "Find you on Google",
  menu: "Your menu",
  allergens: "Allergens",
  voice: "How you sound",
  reward: "Sign-up reward",
  finish: "QR codes and finish",
};

export type StepStatus = "done" | "skipped";
export type Progress = Partial<Record<StepId, { status: StepStatus; at: string }>>;

// The first step that's neither done nor skipped (null = everything is).
export function nextStep(progress: Progress): StepId | null {
  return STEPS.find((s) => !progress[s]) ?? null;
}

// For the progress bar: how many steps are behind the owner.
export function stepsDone(progress: Progress) {
  return STEPS.filter((s) => progress[s]).length;
}

// Finishing needs the WhatsApp number linked (that's where the product runs).
// Everything else can be skipped and done later.
export function canFinish(progress: Progress, whatsappLinked: boolean) {
  return whatsappLinked && STEPS.filter((s) => s !== "finish").every((s) => progress[s]);
}

export function mark(progress: Progress, step: StepId, status: StepStatus, at = new Date().toISOString()): Progress {
  return { ...progress, [step]: { status, at } };
}

// Allergens only make sense once there's a menu: if the menu step was skipped,
// allergens are skipped with it.
export function afterMenu(progress: Progress, menuHasItems: boolean): Progress {
  return menuHasItems ? progress : mark(progress, "allergens", "skipped");
}

// One-time WhatsApp link code: 6 easy-to-read characters (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newLinkCode(random: () => number = Math.random) {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");
}

// Finds a link code in a WhatsApp message, e.g. "Link my restaurant: K7Q2MZ" or just "K7Q2MZ".
export function findLinkCode(text: string) {
  const m = text.toUpperCase().match(/(?:^|[^A-Z0-9])([A-HJ-NP-Z2-9]{6})(?:[^A-Z0-9]|$)/);
  return m ? m[1] : null;
}

// The text pre-filled in WhatsApp when the owner taps "Set up on WhatsApp".
export function linkMessage(code: string) {
  return `Link my restaurant: ${code}`;
}

// A web address safe to use in links for a new restaurant, e.g. "Rose & Thyme" -> "rose-thyme".
export function slugFor(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "restaurant"
  );
}
