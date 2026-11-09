// The GM: the router (Sonnet) that understands each owner message and sends it to the right place, and
// the composer (Sonnet) that writes what the owner reads. Their output shapes, and
// the plain-code rules: no invented numbers, no "just checking in", cards under 40
// words, the owner's language; and the rules code applies around them (the brief's
// 5 cards and their order, one alert an hour, quiet hours). Zod and pure code only,
// so it's unit-tested (tests/agents/gm.test.ts).
import { z } from "zod";
import { quotedNumbers } from "./insights-rules";
import type { Problems } from "./schema";

// ---------- The router ----------

// gm.md's routing table, plus rows code needs: "profile_question" (a simple
// question the profile answers: the composer replies), "chat" (general chat and
// look-ups: the composer answers, with the agents live), "team" (the staff team
// and the rota: lib/rota/understand.ts), "edit" (a change to the draft on the
// owner's screen, typed without tapping Edit), "sales_entry" (a day's sales figure
// told in words: shown back on a confirm card, then saved) and "answer_open" (the
// message answers a question Naila asked and is still waiting on), "how_to" (a
// question about using DinerAI itself: answered from the owner help guide).
export const ROUTES = ["reputation", "growth", "visibility", "insights", "profile_fact", "one_off", "profile_question", "chat", "team", "edit", "sales_entry", "answer_open", "how_to", "ambiguous"] as const;
export type Route = (typeof ROUTES)[number];

// Something Naila asked the owner and is still waiting on. The GM decides whether a
// new message answers it: a waiting question never swallows a message just because
// it's waiting (that's how "Thursday looks quiet" once got read as an answer about Sunday).
export const OPEN_KINDS = ["sales_confirm", "sales_date", "sales_replace", "file_layout", "agent_question", "choice"] as const;
export type OpenKind = (typeof OPEN_KINDS)[number];
export type OpenItem = { ref: string; kind: OpenKind; asks: string; minutes_ago: number };

// A question an agent asked (or a "which did you mean?") stops waiting after this long.
export const AGENT_QUESTION_OPEN_MINUTES = 30;
// A sales question (save it? which day? replace?) or a file layout waits this long.
export const SALES_QUESTION_OPEN_MINUTES = 6 * 60;

export function stillOpen(kind: OpenKind, createdAt: string, now: Date) {
  const minutes = (now.getTime() - new Date(createdAt).getTime()) / 60_000;
  const limit = kind === "agent_question" || kind === "choice" ? AGENT_QUESTION_OPEN_MINUTES : SALES_QUESTION_OPEN_MINUTES;
  return minutes >= -1 && minutes <= limit;
}

// A day's sales as the GM understood it (anything the owner didn't say is null).
export const SalesFigures = z.object({
  business_date: z.string().nullable().describe("The trading day as YYYY-MM-DD (use the dates listed in the input), or null if not said"),
  amount: z.number().nullable().describe("The sales figure in pounds (1500 for £1,500, 1500£ or 1.5k), or null if not said"),
  basis: z.enum(["gross", "net"]).nullable().describe("net = before VAT, ex VAT, excluding VAT or net; gross = including VAT, or a plain 'we took'; null if not said"),
  transactions: z.number().int().nullable().describe("The number of orders or transactions if said, else null (covers or guests are not transactions)"),
});
export type SalesFiguresType = z.infer<typeof SalesFigures>;

export const RouterOutput = z.object({
  route: z.enum(ROUTES),
  request: z
    .string()
    .describe("What the owner wants, restated in one plain English line that makes sense on its own: fill in what they refer to from the conversation (which day, which figure, what 'it' or 'that' is). Empty for ambiguous"),
  language: z.enum(["English", "Urdu", "Roman Urdu", "Mixed English and Urdu", "Other"]).describe("The language the owner wrote in"),
  question: z.string().nullable().describe("ambiguous only: one short question for the owner"),
  options: z.array(z.object({ label: z.string().describe("A button, 20 characters at most"), route: z.enum(ROUTES) })).describe("ambiguous only: 2 or 3 choices"),
  pasted_review: z
    .object({
      author_name: z.string().nullable().describe("The reviewer's name as written, or null"),
      rating: z.number().int().min(1).max(5).nullable().describe("Stars 1 to 5 if shown, or null"),
      text: z.string().describe("The review's own words, exactly as pasted (not the owner's note around it)"),
    })
    .nullable()
    .describe("reputation only: a review the owner pasted or forwarded into the message; otherwise null"),
  open_item: z.string().nullable().describe("answer_open only: the ref of the waiting question this message answers; otherwise null"),
  decision: z.enum(["yes", "no"]).nullable().describe("answer_open only: yes (save it, go ahead, replace it) or no (don't save, cancel, keep the old one) when the owner said so; otherwise null"),
  sales: SalesFigures.nullable().describe(
    "sales_entry: the figure the owner gave. answer_open on a sales question: only what the owner changed (e.g. basis net for 'it was before VAT', or a different day); null fields stay as they were. Otherwise null",
  ),
});
export type RouterOutputType = z.infer<typeof RouterOutput>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// ctx.openRefs: the refs of the questions waiting when the message came in (answer_open must
// name one of them); ctx.today ("YYYY-MM-DD"): sales can't be for a day that hasn't happened.
export function routerProblems(out: RouterOutputType, ctx: { openRefs?: string[]; today?: string } = {}): Problems {
  const problems: Problems = [];
  if (out.route === "ambiguous") {
    if (!out.question?.trim()) problems.push("ambiguous: ask one short question");
    if (out.options.length < 2 || out.options.length > 3) problems.push(`ambiguous: 2 or 3 options (this has ${out.options.length})`);
    for (const o of out.options) {
      if (!o.label.trim()) problems.push("every option needs a label");
      if (o.route === "ambiguous") problems.push("an option can't be ambiguous itself");
      if (o.route === "answer_open") problems.push("an option can't be answer_open");
    }
  } else {
    if (out.question) problems.push("only an ambiguous message gets a question");
    if (out.options.length) problems.push("only an ambiguous message gets options");
    if (!out.request.trim()) problems.push("restate the owner's ask in one line (request)");
  }
  if (out.pasted_review && out.route !== "reputation") problems.push("only a reputation message can carry a pasted review");
  if (out.pasted_review && !out.pasted_review.text.trim()) problems.push("a pasted review needs its text");
  if (out.route === "answer_open") {
    if (!out.open_item) problems.push("answer_open: name the open_item it answers");
    else if (ctx.openRefs && !ctx.openRefs.includes(out.open_item))
      problems.push(`answer_open: "${out.open_item}" isn't waiting (waiting: ${ctx.openRefs.join(", ") || "nothing"}); route the message by what it asks instead`);
    else if (out.open_item === "choice") problems.push("a \"which did you mean?\" isn't answered with answer_open: route the clarified message by what it asks");
  } else {
    if (out.open_item) problems.push("only answer_open names an open_item");
    if (out.decision) problems.push("only answer_open carries a decision");
  }
  if (out.sales && out.route !== "sales_entry" && out.route !== "answer_open") problems.push("only sales_entry or answer_open carries sales figures");
  // A specialist can't save a figure: a day's sales given in answer to its question is still sales_entry.
  if (out.route === "answer_open" && out.open_item === "question" && out.sales?.amount != null)
    problems.push("a day's sales figure is sales_entry (code shows it back and saves it), even when it answers a specialist's question asking for it");
  if (out.route === "sales_entry") {
    if (!out.sales || out.sales.amount === null) problems.push("sales_entry: give the amount in sales.amount (pounds)");
    else if (!(out.sales.amount >= 1 && out.sales.amount <= 500_000)) problems.push("sales_entry: the amount must be between £1 and £500,000");
  }
  if (out.sales?.business_date) {
    if (!YMD.test(out.sales.business_date)) problems.push("sales.business_date must be YYYY-MM-DD");
    else if (ctx.today && out.sales.business_date > ctx.today) problems.push("sales.business_date can't be in the future: sales are for days that have happened");
  }
  return problems;
}

// "Monday 9 Nov = 2026-11-09 (today)" and the 7 days before, so the router can
// turn "yesterday", "Saturday" or "last night" into a date without arithmetic.
export function recentDays(today: string, back = 7) {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: back + 1 }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    const label = day.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" });
    return `${label} = ${day.toISOString().slice(0, 10)}${i === 0 ? " (today)" : i === 1 ? " (yesterday)" : ""}`;
  }).join("\n");
}

// The recent conversation as the agents read it (oldest first).
export type ConversationLine = { from: "owner" | "naila"; text: string };

export function conversationText(lines: ConversationLine[]) {
  return lines.length ? lines.map((m) => `${m.from === "owner" ? "Owner" : "Naila"}: ${m.text}`).join("\n") : "(none)";
}

// What a specialist working on an owner's message gets besides the message: what
// they mean (the GM's words, with the conversation filled in) and the conversation.
export type OwnerContext = { meaning: string | null; conversation: ConversationLine[] };

export function contextText(context: OwnerContext | null | undefined) {
  if (!context) return "";
  const parts: string[] = [];
  if (context.meaning) parts.push(`What the owner means, given the conversation: ${context.meaning}`);
  if (context.conversation.length)
    parts.push(
      `The conversation before this message (oldest first). It's context: act on the owner's latest message. Never ask for something already said, and don't repeat a point already made unless it's what they asked about:\n${conversationText(context.conversation)}`,
    );
  return parts.join("\n\n");
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
  chat: "general chat and look-ups",
  team: "the rota (staff team and rota changes)",
  edit: "a change to the draft on screen",
  sales_entry: "a day's sales (confirm card, then saved)",
  answer_open: "the answer to a question Naila asked",
  how_to: "the help guide (how to use DinerAI)",
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
