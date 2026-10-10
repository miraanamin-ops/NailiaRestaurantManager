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

// Finds a link code in a WhatsApp message: "Link my restaurant: K7Q2MZ" (the
// pre-filled message). Never a code on its own: STATUS or THANKS would look like one.
export function findLinkCode(text: string) {
  const m = text.trim().toUpperCase().match(/^LINK\b[^:]*:\s*([A-HJ-NP-Z2-9]{6})[.!]?$/);
  return m ? m[1] : null;
}

// What the owner typed as their WhatsApp number -> "whatsapp:+447700900123".
// UK numbers by default: "07700 900123", "+44 7700 900123" and "0044..." all work.
export function normaliseWhatsApp(raw: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  const intl = digits.startsWith("+")
    ? digits
    : digits.startsWith("00")
      ? `+${digits.slice(2)}`
      : digits.startsWith("0")
        ? `+44${digits.slice(1)}`
        : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(intl) ? `whatsapp:${intl}` : null;
}

// "whatsapp:+447700900123" -> "+44 7700 900123" (for showing on screen).
export function showNumber(whatsapp: string | null) {
  const n = (whatsapp ?? "").replace(/^whatsapp:/, "");
  const uk = n.match(/^\+44(\d{4})(\d{6})$/);
  return uk ? `+44 ${uk[1]} ${uk[2]}` : n;
}

// A wa.me link that opens WhatsApp with a message ready to send to our number.
export function whatsAppLink(ourNumber: string, text: string) {
  return `https://wa.me/${ourNumber.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

// ---------- Replies on WhatsApp during onboarding ----------

export type OnboardingReply =
  | { kind: "yes" | "no" | "skip" | "done" | "web" | "help" }
  | { kind: "pick"; n: number }
  | { kind: "text"; text: string };

export function parseOnboardingReply(body: string): OnboardingReply {
  const t = body.trim().toLowerCase().replace(/[.!👍]+$/u, "").trim();
  if (/^(yes|y|yep|yeah|ok|okay|correct|looks good|that's right|thats right|perfect|confirm)$/.test(t)) return { kind: "yes" };
  if (/^(no|n|nope|none|none of these|not me|neither)$/.test(t)) return { kind: "no" };
  if (/^(skip|later|skip this|next)$/.test(t)) return { kind: "skip" };
  if (/^(done|finish|finished|that's all|thats all|all done|that's it|thats it)$/.test(t)) return { kind: "done" };
  if (/^(web|website|online|link|on the web)$/.test(t)) return { kind: "web" };
  if (/^(help|\?|where was i|status|continue|carry on|carry on setting up|start|hi|hello|hey)$/.test(t)) return { kind: "help" };
  const n = t.match(/^#?([1-9])$/);
  if (n) return { kind: "pick", n: Number(n[1]) };
  return { kind: "text", text: body.trim() };
}

// The reward step on WhatsApp: "cap 20", "20%", or a new reward ("a free samosa").
export function parseRewardReply(text: string): { cap?: number; reward?: string } {
  const cap = text.match(/(?:\bcap\b\D*)?(\d{1,3})\s*%/i) ?? text.match(/\bcap\s*(?:of|at|to)?\s*(\d{1,3})\b/i);
  if (cap && Number(cap[1]) <= 100) {
    const rest = text
      .replace(cap[0], "")
      .replace(/[\s,.]*\b(and|with)\b[\s,.]*$/i, "")
      .replace(/^[\s,.]+|[\s,.]+$/g, "");
    return { cap: Number(cap[1]), ...(rest.length > 3 ? { reward: tidyReward(rest) } : {}) };
  }
  return { reward: tidyReward(text) };
}

function tidyReward(text: string) {
  const t = text.trim().replace(/[.!]+$/, "").slice(0, 100);
  return /^(a|an|one|two|\d+%?|free)\b/i.test(t) ? t : `a ${t}`;
}

// Long WhatsApp messages split on line breaks (WhatsApp's limit is 1600 characters).
export function splitMessage(text: string, max = 1500) {
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > max) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line.slice(0, max);
  }
  if (current) parts.push(current);
  return parts;
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
