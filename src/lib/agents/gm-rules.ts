// The GM: the router (Haiku) that sends each owner message to the right place, and
// the composer (Sonnet) that writes what the owner reads. Their output shapes, and
// the plain-code rules: no invented numbers, no "just checking in", cards under 40
// words, the owner's language; and the rules code applies around them (the brief's
// 5 cards and their order, one alert an hour, quiet hours). Zod and pure code only,
// so it's unit-tested (tests/agents/gm.test.ts).
import { z } from "zod";
import { quotedNumbers } from "./insights-rules";
import type { Problems } from "./schema";

// ---------- The router ----------

// gm.md's routing table, plus two rows code needs: "profile_question" (a simple
// question the profile answers: the composer replies) and "chat" (general chat and
// look-ups, still answered by today's assistant until the GM covers them).
export const ROUTES = ["reputation", "growth", "visibility", "insights", "profile_fact", "one_off", "profile_question", "chat", "ambiguous"] as const;
export type Route = (typeof ROUTES)[number];

export const RouterOutput = z.object({
  route: z.enum(ROUTES),
  request: z.string().describe("The owner's ask restated in one plain English line (empty for ambiguous)"),
  language: z.enum(["English", "Urdu", "Roman Urdu", "Mixed English and Urdu", "Other"]).describe("The language the owner wrote in"),
  question: z.string().nullable().describe("ambiguous only: one short question for the owner"),
  options: z.array(z.object({ label: z.string().describe("A button, 20 characters at most"), route: z.enum(ROUTES) })).describe("ambiguous only: 2 or 3 choices"),
});
export type RouterOutputType = z.infer<typeof RouterOutput>;

export function routerProblems(out: RouterOutputType): Problems {
  const problems: Problems = [];
  if (out.route === "ambiguous") {
    if (!out.question?.trim()) problems.push("ambiguous: ask one short question");
    if (out.options.length < 2 || out.options.length > 3) problems.push(`ambiguous: 2 or 3 options (this has ${out.options.length})`);
    for (const o of out.options) {
      if (!o.label.trim()) problems.push("every option needs a label");
      if (o.route === "ambiguous") problems.push("an option can't be ambiguous itself");
    }
  } else {
    if (out.question) problems.push("only an ambiguous message gets a question");
    if (out.options.length) problems.push("only an ambiguous message gets options");
    if (!out.request.trim()) problems.push("restate the owner's ask in one line (request)");
  }
  return problems;
}

// WhatsApp buttons take 20 characters: a longer label is shortened at a word ("Google or social posts" -> "Google or social").
export function buttonLabel(label: string, max = 20) {
  const t = label.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "").trim();
  return cut.length >= 3 ? cut : t.slice(0, max).trim();
}

// Where each route goes, in words (logs and the comparison).
export const ROUTE_WORDS: Record<Route, string> = {
  reputation: "Reputation",
  growth: "Growth",
  visibility: "Visibility",
  insights: "Insights",
  profile_fact: "a profile change (confirm card)",
  one_off: "Visibility (one-off writing)",
  profile_question: "the composer (answered from the profile)",
  chat: "today's assistant",
  ambiguous: "a question with buttons",
};

// ---------- The composer ----------

export const COMPOSE_KINDS = ["brief", "card", "alert", "reply", "report"] as const;
export type ComposeKind = (typeof COMPOSE_KINDS)[number];

export const ComposerOutput = z.object({
  type: z.enum(COMPOSE_KINDS),
  message: z.string().describe("The text the owner will see"),
});
export type ComposerOutputType = z.infer<typeof ComposerOutput>;

const CHECKING_IN = /\b(just (?:checking|wanted to check) in|checking in|touch(?:ing)? base|hope (?:you(?:'re| are)|all is|everything is) (?:well|good)|let me know if you need anything|how are things|just a reminder|quick reminder)\b/i;
const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const URDU_SCRIPT = /[؀-ۿ]/g;
const ROMAN_URDU = /\b(hai|hain|ka|ki|ke|ko|kya|kyun|karo|karein|kar|kuch|nahi|nahin|aap|hum|ab|mein|bhi|bohat|bahut|acha|achha|theek|hafte|haftay|din|raat|subah|shukriya|jee|ji|wala|wali|liye|se|tak|baje)\b/gi;

export type LanguageSeen = "English" | "Urdu" | "Roman Urdu";

// The language a text is mostly in (plain code, for the composer's rule).
export function languageOf(text: string): LanguageSeen {
  const letters = (text.match(/\p{L}/gu) ?? []).length || 1;
  if ((text.match(URDU_SCRIPT) ?? []).length / letters > 0.3) return "Urdu";
  if ((text.match(ROMAN_URDU) ?? []).length >= 2) return "Roman Urdu";
  return "English";
}

// The language the owner should get: what they wrote in (a reply), or their profile language.
export function expectedLanguage(input: { ownerMessage?: string | null; profileLanguage?: string | null }): LanguageSeen {
  if (input.ownerMessage) return languageOf(input.ownerMessage);
  const p = (input.profileLanguage ?? "English").toLowerCase();
  if (/^urdu\b/.test(p) && !/english/.test(p)) return "Urdu";
  return "English";
}

export const CARD_MAX_WORDS = 40;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export type ComposerContext = {
  kind: ComposeKind;
  // Every number the composer may quote: from the receipts, the drafts and the data it was given (code's).
  allowedNumbers: number[];
  language: LanguageSeen;
};

export function composerProblems(out: ComposerOutputType, ctx: ComposerContext): Problems {
  const problems: Problems = [];
  const text = out.message.trim();
  if (out.type !== ctx.kind) problems.push(`this is a ${ctx.kind}: type ${ctx.kind}`);
  if (!text) problems.push("the message is empty");
  if (CHECKING_IN.test(text)) problems.push(`no "${text.match(CHECKING_IN)![0]}": every message carries a decision or a result`);
  if (EM_DASH.test(text)) problems.push("no em-dashes");
  if (ctx.kind === "card" && words(text) > CARD_MAX_WORDS) problems.push(`a card is under ${CARD_MAX_WORDS} words (this is ${words(text)})`);
  if (ctx.kind === "report" && text.split("\n").filter((l) => l.trim()).length > 2) problems.push("the Monday message is 2 lines");
  // Every number is one code gave it (receipts, the draft, the data): never invented.
  const allowed = ctx.allowedNumbers;
  for (const q of quotedNumbers(text)) {
    if (q.kind === "number" && Number.isInteger(q.value) && q.value <= 12) continue;
    if (!allowed.some((a) => Math.abs(a - q.value) < 0.005 || Math.round(a) === q.value)) problems.push(`"${q.text}" isn't in the receipts, the draft or the data: never state a number you weren't given`);
  }
  const lang = languageOf(text);
  if (ctx.language !== "English" && lang === "English") problems.push(`reply in the owner's language (${ctx.language})`);
  if (ctx.language === "English" && lang !== "English") problems.push("reply in English, the owner's language");
  return problems;
}

// Every number in some text (for allowedNumbers): money, percentages and counts.
export function numbersFrom(...texts: (string | null | undefined)[]) {
  return texts.flatMap((t) => (t ? (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))) : []));
}

// ---------- The rules code applies around the GM ----------

export const BRIEF_MAX_CARDS = 5;

export type BriefItem = { id: string; urgent: boolean; send_at: string | null; created_at: string };

// gm.md: up to 5 cards, ranked urgent first, then time-sensitive by send date, then
// oldest first. The rest roll to tomorrow.
export function rankBriefItems<T extends BriefItem>(items: T[], max = BRIEF_MAX_CARDS) {
  const sorted = [...items].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.send_at && b.send_at) return a.send_at.localeCompare(b.send_at) || a.created_at.localeCompare(b.created_at);
    if (a.send_at || b.send_at) return a.send_at ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
  return { today: sorted.slice(0, max), tomorrow: sorted.slice(max) };
}

// Quiet hours ("23:00:00" to "09:00:00", UK time; they can run over midnight).
export function inQuietHours(londonMinutes: number, start: string | null | undefined, end: string | null | undefined) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = m(start ?? "23:00");
  const e = m(end ?? "09:00");
  if (s === e) return false;
  return s < e ? londonMinutes >= s && londonMinutes < e : londonMinutes >= s || londonMinutes < e;
}

// When an alert may go: now, or the end of quiet hours, or an hour after the last alert.
export function alertTime(input: { now: Date; londonMinutes: number; quietStart: string | null; quietEnd: string | null; lastAlertAt: Date | null }): { send: "now" } | { send: "later"; reason: "quiet_hours" | "hourly_limit" } {
  if (inQuietHours(input.londonMinutes, input.quietStart, input.quietEnd)) return { send: "later", reason: "quiet_hours" };
  if (input.lastAlertAt && input.now.getTime() - input.lastAlertAt.getTime() < 60 * 60 * 1000) return { send: "later", reason: "hourly_limit" };
  return { send: "now" };
}

// The "on it" line: sent once, only if the real reply isn't ready within this long.
export const ON_IT_AFTER_MS = 8000;
export const ON_IT_LINES: Record<"English" | "Urdu" | "Roman Urdu", string> = {
  English: "On it, back in a minute.",
  "Roman Urdu": "Kar raha hoon, ek minute mein bataata hoon.",
  Urdu: "کر رہا ہوں، ایک منٹ میں بتاتا ہوں۔",
};

// One-tap skip reasons (never a follow-up question).
export const SKIP_REASONS = ["Wrong tone", "Wrong offer", "Not now"] as const;
