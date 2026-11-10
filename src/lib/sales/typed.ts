// A day's sales typed on WhatsApp instead of a till report photo: "we took £2,340
// yesterday, 180 orders", "takings 1850 net", "Monday £1,920". Plain code, no
// imports beyond the sales helpers (tests/sales-typed.test.ts). Anything that might
// be chat (a question, an offer, a week's total, two amounts) is left to chat; what
// it does read is always shown back for a YES before it's saved (lib/sales/z-reports.ts).
import { addDays, dayLabel, gbp } from "./format";
import { parseDay, type ZFigures, type ZRead } from "./z-check";

export type TypedTakings = {
  business_date: string; // "YYYY-MM-DD"
  amount: number; // pounds
  basis: "gross" | "net"; // gross: including VAT (what "we took" usually means)
  transactions: number | null;
};

// The best sales data a restaurant has sent lately, for asking for something better.
export type BestSalesData = "items" | "hours" | "daily" | "none";

// After this London hour a typed total with no day is for today (the night's takings); before it, yesterday.
export const TODAY_FROM_HOUR = 16;

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const QUESTION = /\?|^(?:did|do|does)\b(?! £?\d)|^(what|how|can|could|should|would|will|why|when|which|where|who|is|are|was|were|show|tell|give|compare|any)\b/;
// Offers, costs, targets and longer periods: chat, not a day's takings.
const NOT_TAKINGS =
  /%|\b(off|discounts?|offers?|deals?|vouchers?|rewards?|prices?|priced|costs?|costing|wages?|salary|rent|budget|target|goal|forecast\w*|profit|tips?|spend|spent|invoices?|suppliers?|weeks?|weekend|months?|years?|fortnight|average|per head|each|cap|refund\w*|next|tomorrow|coming)\b/;
const SALES_WORD = /\b(took|take|taken|takings?|sales|sold|turnover|revenue|did|made|banked|till|z-? ?report|total|net|gross)\b/;
const NET_WORD = /\b(net|ex\.? ?vat|excl\w*\.? ?vat|excluding vat|before vat|without vat|minus vat|less vat)\b/;
const COUNT = /(?<![£\d.,])(\d{1,3}(?:,\d{3})+|\d+)\s*(orders?|transactions?|receipts?|bills|checks|tickets|customers|covers|sales)\b/g;
const DATES = [
  /\b(today|tonight|yesterday|last night)\b/,
  /\b(?:on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:'s)?\b/,
  new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})[a-z]*(?: \\d{4})?)\\b`),
  new RegExp(`\\b((?:${MONTHS})[a-z]* \\d{1,2}(?:st|nd|rd|th)?)\\b`),
  /(?<![£\d.,])(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?![\d])/,
];
const MONEY = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?(?!\d|,\d)|(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?\s?(?:pounds|quid|gbp)\b/g;
const BARE = /(?<![\d.,£/])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?(?![\d/]|,\d)/g;
// Words that can sit around a total without making it chat ("we took £2,340 yesterday").
const FILLER = /\b(we|i|it|was|were|is|of|and|with|for|on|from|in|at|about|around|roughly|just|over|under|so|far|our|the|a|an|hi|hey|morning|evening|night|thanks|thank you|ta|cheers|inc|incl|including|vat|net|gross|ex|excl|excluding|before|after|minus|less|total|today|tonight|yesterday|last|z|report|till|took|take|taken|takings?|sales|sold|turnover|revenue|did|made|banked)\b/g;

const toAmount = (whole: string, dec: string | undefined, k: string | undefined) => {
  const n = Number(whole.replace(/,/g, "") + (dec ?? ""));
  return k ? n * 1000 : n;
};

// null: not a typed day's sales (carry on as chat). today: London's "YYYY-MM-DD"; hour: London's hour now.
export function parseTypedTakings(body: string, today: string, hour: number): TypedTakings | null {
  let t = body.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
  if (!t || t.length > 160 || QUESTION.test(t) || NOT_TAKINGS.test(t)) return null;

  // The day: a word or date in the message, else yesterday (or today in the evening).
  let day: string | null = null;
  for (const re of DATES) {
    const m = t.match(re);
    if (!m) continue;
    const words = m[1] === "tonight" ? "today" : m[1];
    day = parseDay(words, today);
    if (!day) return null;
    t = t.replace(m[0], " ");
    break;
  }
  if (!day) day = hour >= TODAY_FROM_HOUR ? today : addDays(today, -1);
  if (day > today) return null;

  // The number of orders ("180 orders"); covers are guests, not orders, so they're only taken out.
  let transactions: number | null = null;
  for (const m of [...t.matchAll(COUNT)]) {
    if (m[2] !== "covers" && m[2] !== "customers") {
      if (transactions !== null) return null;
      transactions = Number(m[1].replace(/,/g, ""));
    }
    t = t.replace(m[0], " ");
  }

  // Exactly one amount: in pounds ("£2,340", "2.3k pounds"), or a bare number next to a sales word.
  const basis = NET_WORD.test(t) ? "net" : "gross";
  const hasSalesWord = SALES_WORD.test(t);
  let amounts = [...t.matchAll(MONEY)].map((m) => ({ text: m[0], n: m[1] ? toAmount(m[1], m[2], m[3]) : toAmount(m[4], m[5], m[6]) }));
  if (!amounts.length && hasSalesWord) amounts = [...t.matchAll(BARE)].map((m) => ({ text: m[0], n: toAmount(m[1], m[2], m[3]) }));
  if (amounts.length !== 1) return null;
  const amount = amounts[0].n;
  if (!(amount >= 1 && amount <= 500_000)) return null;
  t = t.replace(amounts[0].text, " ");

  // A sales word, or nothing else said ("£2,340, 180 orders").
  const rest = t.replace(FILLER, " ").replace(/[^a-z0-9]+/g, " ").trim();
  if (!hasSalesWord && rest) return null;
  if (rest.split(" ").filter(Boolean).length > 3) return null;
  return { business_date: day, amount: Math.round(amount * 100) / 100, basis, transactions };
}

// As the till report reader would have read it, so the same checks and saving apply.
export function typedRead(t: TypedTakings): ZRead {
  return {
    is_till_report: true,
    business_date: t.business_date,
    gross_sales: t.basis === "gross" ? t.amount : null,
    net_sales: t.basis === "net" ? t.amount : null,
    vat: null,
    transactions: t.transactions,
    card: null,
    cash: null,
    other_payments: null,
    discounts: null,
    refunds: null,
    hourly: [],
    unclear: [],
  };
}

// "£2,340 including VAT (about £1,950 before VAT), 180 orders"
export function typedSummary(f: Pick<ZFigures, "gross_sales" | "net_sales" | "transactions" | "net_estimated">) {
  const parts =
    f.gross_sales !== null
      ? [`${gbp(f.gross_sales, true)} including VAT (${f.net_estimated ? "about " : ""}${gbp(f.net_sales ?? 0, true)} before VAT)`]
      : [`${gbp(f.net_sales ?? 0, true)} before VAT`];
  if (f.transactions !== null) parts.push(`${f.transactions} order${f.transactions === 1 ? "" : "s"}`);
  return parts.join(", ");
}

// Why better data helps, and what's better than what they've sent, in one line (none if they send item sales).
export function betterDataLine(best: BestSalesData) {
  if (best === "items") return null;
  const better = best === "hours" ? "your till's sales-by-item export (CSV or Excel)" : "your till's sales-by-item export (CSV or Excel), or failing that sales by the hour,";
  return `💡 Even better: ${better} shows which dishes and hours make you the most, so I can find you more profit. Send it here whenever you can.`;
}

export function typedConfirmQuestion(f: ZFigures, problems: string[], today: string, best: BestSalesData) {
  const day = dayLabel(f.business_date!, Number(today.slice(0, 4)));
  const lines = [`🧾 *${day}*: ${typedSummary(f)}. Save it?`];
  if (problems.length) lines.push(problems.slice(0, 3).map((p) => `- ${p[0].toUpperCase()}${p.slice(1)}`).join("\n"));
  // No special words: anything the owner says back is understood (lib/agents/gm-open.ts).
  const vat = f.gross_sales !== null ? ` If ${gbp(f.gross_sales, true)} was before VAT, or it's for a different day, just say so.` : " If it's for a different day, or the figure's not right, just say so.";
  lines.push(`Reply *YES* to save it.${vat}`);
  const tip = betterDataLine(best);
  if (tip) lines.push(tip);
  return lines.join("\n");
}

export function typedSavedLine(f: ZFigures, today: string) {
  return `${dayLabel(f.business_date!, Number(today.slice(0, 4)))}: ${typedSummary(f)}. Saved. 👍`;
}

export const TYPED_DISCARDED = "OK, I didn't save it. Tell me the figure again whenever you're ready.";

// What the owner changed about a figure waiting for a yes ("it was before VAT",
// "no, Saturday", "actually £1,650"): null = unchanged.
export type SalesChange = { business_date: string | null; amount: number | null; basis: "gross" | "net" | null; transactions: number | null };

export const changesSomething = (c: SalesChange | null | undefined): c is SalesChange =>
  Boolean(c && (c.business_date !== null || c.amount !== null || c.basis !== null || c.transactions !== null));

// The read with the change applied, for the same checks and confirm card again.
// A new amount or basis replaces the single total (VAT and the payment split no
// longer apply to it); "before VAT" alone moves the one figure there is to net (or to
// gross for "including VAT"). With both totals read off a till report, a basis alone
// changes nothing (the report says which is which).
export function applySalesChange(read: ZRead, change: SalesChange): ZRead {
  const next: ZRead = { ...read };
  if (change.business_date) next.business_date = change.business_date;
  if (change.transactions !== null) next.transactions = change.transactions;
  const single = read.gross_sales !== null && read.net_sales !== null ? null : (read.gross_sales ?? read.net_sales);
  const currentBasis: "gross" | "net" = read.gross_sales === null && read.net_sales !== null ? "net" : "gross";
  const amount = change.amount ?? (change.basis ? single : null);
  if (amount !== null && (change.amount !== null || change.basis !== currentBasis)) {
    const basis = change.basis ?? currentBasis;
    next.gross_sales = basis === "gross" ? amount : null;
    next.net_sales = basis === "net" ? amount : null;
    next.vat = null;
    if (change.amount !== null) Object.assign(next, { card: null, cash: null, other_payments: null });
  }
  return next;
}
