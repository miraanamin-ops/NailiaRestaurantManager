// Checking a till report ("Z-report") that the AI read from a photo, and the
// WhatsApp wording around it. Plain code (tests/sales.test.ts): the AI only
// reads the numbers; whether they add up is decided here.
import { addDays, dayLabel, daysBetween, gbp, round2, WEEKDAY_NAMES, weekdayOf } from "./format";

// What the AI read. Anything it couldn't see is null.
export type ZRead = {
  is_till_report: boolean;
  business_date: string | null; // "YYYY-MM-DD"
  gross_sales: number | null; // total takings including VAT
  net_sales: number | null; // excluding VAT
  vat: number | null;
  transactions: number | null;
  card: number | null;
  cash: number | null;
  other_payments: number | null; // vouchers, delivery apps, etc.
  discounts: number | null;
  refunds: number | null;
  hourly: { hour: number; sales: number }[];
  unclear: string[]; // fields it wasn't sure about, in plain words
};

// The numbers we keep (some worked out from the others).
export type ZFigures = {
  business_date: string | null;
  gross_sales: number | null;
  net_sales: number | null;
  vat: number | null;
  transactions: number | null;
  card: number | null;
  cash: number | null;
  other_payments: number | null;
  discounts: number | null;
  refunds: number | null;
  hourly: { hour: number; sales: number }[];
  net_estimated: boolean; // no VAT figure on the report: net worked out at 20%
};

export type ZCheck =
  | { status: "not_report" }
  | { status: "unreadable"; figures: ZFigures }
  | { status: "needs_date"; figures: ZFigures; problems: string[] }
  | { status: "needs_confirm"; figures: ZFigures; problems: string[] }
  | { status: "ok"; figures: ZFigures };

// Rounding on tills is to the penny, but photos and VAT splits can be a little off.
const close = (a: number, b: number, pct = 0.005) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * pct);
const has = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n);
const STANDARD_VAT = 0.2;

export function figuresFrom(read: ZRead): ZFigures {
  let { gross_sales: gross, net_sales: net, vat } = read;
  let estimated = false;
  if (!has(net) && has(gross) && has(vat)) net = round2(gross - vat);
  if (!has(gross) && has(net) && has(vat)) gross = round2(net + vat);
  if (!has(vat) && has(gross) && has(net)) vat = round2(gross - net);
  if (!has(net) && has(gross)) {
    net = round2(gross / (1 + STANDARD_VAT));
    estimated = true;
  }
  const hourly = (read.hourly ?? [])
    .filter((h) => Number.isInteger(h.hour) && h.hour >= 0 && h.hour <= 23 && has(h.sales))
    .map((h) => ({ hour: h.hour, sales: round2(h.sales) }));
  return {
    business_date: read.business_date && /^\d{4}-\d{2}-\d{2}$/.test(read.business_date) ? read.business_date : null,
    gross_sales: has(gross) ? round2(gross) : null,
    net_sales: has(net) ? round2(net) : null,
    vat: has(vat) ? round2(vat) : null,
    transactions: has(read.transactions) ? Math.round(read.transactions) : null,
    card: has(read.card) ? round2(read.card) : null,
    cash: has(read.cash) ? round2(read.cash) : null,
    other_payments: has(read.other_payments) ? round2(read.other_payments) : null,
    discounts: has(read.discounts) ? round2(Math.abs(read.discounts)) : null,
    refunds: has(read.refunds) ? round2(Math.abs(read.refunds)) : null,
    hourly,
    net_estimated: estimated,
  };
}

// Does it add up? today is London's "YYYY-MM-DD".
export function checkZReport(read: ZRead, today: string): ZCheck {
  if (!read.is_till_report) return { status: "not_report" };
  const f = figuresFrom(read);
  if (!has(f.net_sales)) return { status: "unreadable", figures: f };

  const problems: string[] = [];
  // Net + VAT = gross, when all three were printed.
  if (has(read.net_sales) && has(read.vat) && has(read.gross_sales) && !close(read.net_sales + read.vat, read.gross_sales)) {
    problems.push(`net ${gbp(read.net_sales, true)} + VAT ${gbp(read.vat, true)} = ${gbp(read.net_sales + read.vat, true)}, but the total says ${gbp(read.gross_sales, true)}`);
  }
  // Card + cash (+ other) = the total taken (some tills take refunds off first).
  if (has(f.card) && has(f.cash) && has(f.gross_sales)) {
    const paid = f.card + f.cash + (f.other_payments ?? 0);
    const totals = [f.gross_sales, f.gross_sales - (f.refunds ?? 0), f.gross_sales - (f.discounts ?? 0)];
    if (!totals.some((t) => close(paid, t))) {
      const what = `card ${gbp(f.card, true)} + cash ${gbp(f.cash, true)}${has(f.other_payments) ? ` + other ${gbp(f.other_payments, true)}` : ""}`;
      const diff = round2(paid - f.gross_sales);
      problems.push(`${what} = ${gbp(paid, true)}, which is ${gbp(Math.abs(diff), true)} ${diff < 0 ? "less" : "more"} than the total ${gbp(f.gross_sales, true)}`);
    }
  }
  // Hourly sales should add up to the day (2% leeway: hourly lines are often rounded).
  if (f.hourly.length >= 2) {
    const sum = f.hourly.reduce((s, h) => s + h.sales, 0);
    const targets = [f.gross_sales, f.net_sales].filter(has);
    if (!targets.some((t) => close(sum, t, 0.02))) problems.push(`the hourly sales add up to ${gbp(sum, true)}, not the day's total`);
  }
  if (has(f.transactions) && f.transactions > 0 && f.net_sales > 0) {
    const avg = f.net_sales / f.transactions;
    if (avg > 400 || avg < 0.5) problems.push(`${f.transactions} sales for ${gbp(f.net_sales)} looks unusual (${gbp(avg, true)} each)`);
  }
  if (f.net_sales < 0) problems.push("the total is below zero");
  for (const u of read.unclear ?? []) if (u.trim()) problems.push(`I wasn't sure about ${u.trim().replace(/[.]$/, "")}`);

  if (!f.business_date) return { status: "needs_date", figures: f, problems };
  const age = daysBetween(f.business_date, today);
  if (age < 0) problems.push(`the date (${dayLabel(f.business_date)}) is in the future`);
  else if (age > 45) problems.push(`the date is ${dayLabel(f.business_date, Number(today.slice(0, 4)))}, over ${Math.floor(age / 7)} weeks ago`);

  return problems.length ? { status: "needs_confirm", figures: f, problems } : { status: "ok", figures: f };
}

// Are two reports for the same day the same numbers? (Then there's nothing to replace.)
export function sameFigures(a: Pick<ZFigures, "net_sales" | "transactions">, b: Pick<ZFigures, "net_sales" | "transactions">) {
  return a.net_sales !== null && b.net_sales !== null && Math.abs(a.net_sales - b.net_sales) < 0.01 && (a.transactions ?? -1) === (b.transactions ?? -1);
}

// ---------- WhatsApp wording ----------

// The figures in the order the till prints them, to the penny, so the owner can
// check them against the paper: "£2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions"
export function summary(f: Pick<ZFigures, "gross_sales" | "vat" | "net_sales" | "transactions" | "net_estimated">) {
  const parts: string[] = [];
  if (f.gross_sales !== null) parts.push(`${gbp(f.gross_sales, true)} sales`);
  if (f.vat !== null && !f.net_estimated) parts.push(`${gbp(f.vat, true)} VAT`);
  parts.push(`${gbp(f.net_sales ?? 0, true)} net${f.net_estimated ? " (no VAT on the report, so worked out at 20%)" : ""}`);
  if (f.transactions !== null) parts.push(`${f.transactions} transaction${f.transactions === 1 ? "" : "s"}`);
  return parts.join(", ");
}

// The one-line confirmation: "Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved."
export function savedLine(f: ZFigures, today: string) {
  return `${dayLabel(f.business_date!, Number(today.slice(0, 4)))}: ${summary(f)}. Saved.`;
}

function readLine(f: ZFigures, today: string) {
  const when = f.business_date ? `*${dayLabel(f.business_date, Number(today.slice(0, 4)))}*: ` : "";
  return `${when}${summary(f)}`;
}

export function confirmQuestion(f: ZFigures, problems: string[], today: string) {
  const issues = problems.slice(0, 3).map((p) => `- ${p[0].toUpperCase()}${p.slice(1)}`).join("\n");
  return `🧾 I read ${readLine(f, today)}.\nBut something doesn't add up:\n${issues}\n\nReply *YES* to save it as it is, or send a clearer photo.`;
}

export function dateQuestion(f: ZFigures, today: string) {
  return `🧾 I read ${readLine(f, today)}, but couldn't see the date. Which day is it for? Reply e.g. *yesterday* or *${dayLabel(addDays(today, -1)).replace(/^\w+ /, "")}*, or send a clearer photo.`;
}

export function replaceQuestion(f: ZFigures, earlier: Pick<ZFigures, "gross_sales" | "vat" | "net_sales" | "transactions" | "net_estimated">, today: string) {
  const day = dayLabel(f.business_date!, Number(today.slice(0, 4)));
  return `🧾 You already sent a report for *${day}* (${summary(earlier)}). This one says ${summary(f)}.\nReplace the earlier one? Reply *REPLACE* or *KEEP*.`;
}

export const UNREADABLE_REPLY =
  "🧾 I couldn't read the totals on that photo. Could you send another one, flat and in good light, with the whole report in the picture?";

export function alreadySavedLine(f: ZFigures, today: string) {
  return `🧾 ${dayLabel(f.business_date!, Number(today.slice(0, 4)))} is already saved with the same numbers (${summary(f)}). Nothing changed.`;
}

// ---------- Replies to a question ----------

export type SalesReply = { kind: "yes" | "no" | "replace" | "keep" } | { kind: "date"; ymd: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// YES / NO / REPLACE / KEEP, or a date ("yesterday", "9 Oct", "9/10", "Thursday").
// today is London's "YYYY-MM-DD". Anything else: null (normal chat carries on).
export function parseSalesReply(body: string, today: string): SalesReply | null {
  const t = body.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (/^(yes|y|yep|yeah|save|save it|ok|okay|confirm|correct|that's right|thats right)$/.test(t)) return { kind: "yes" };
  if (/^(no|n|nope|cancel|discard|don't save|dont save|wrong)$/.test(t)) return { kind: "no" };
  if (/^(replace|replace it|overwrite|use the new one)$/.test(t)) return { kind: "replace" };
  if (/^(keep|keep it|keep the old one|keep the earlier one)$/.test(t)) return { kind: "keep" };
  const ymd = parseDay(t, today);
  return ymd ? { kind: "date", ymd } : null;
}

export function parseDay(text: string, today: string): string | null {
  const t = text.trim().toLowerCase().replace(/^(it'?s |for |on )/, "");
  if (t === "today") return today;
  if (t === "yesterday" || t === "last night") return addDays(today, -1);
  // "thursday" / "thu": the most recent one (today counts, as tills are often closed after midnight)
  const wd = WEEKDAY_NAMES.findIndex((n) => t === n.toLowerCase() || t === n.slice(0, 3).toLowerCase());
  if (wd >= 0) return addDays(today, -((weekdayOf(today) - wd + 7) % 7));
  const year = Number(today.slice(0, 4));
  const pick = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const back = new Date(`${ymd}T00:00:00Z`);
    if (back.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
    // No year given and it would be in the future: they mean last year.
    return daysBetween(ymd, today) < 0 && y === year ? `${y - 1}${ymd.slice(4)}` : ymd;
  };
  // "9 oct", "9th october", "9 oct 2026"
  let m = t.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]*(?: (\d{4}))?$/);
  if (m && MONTHS.includes(m[2])) return pick(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[2]) + 1, Number(m[1]));
  // "oct 9"
  m = t.match(/^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/);
  if (m && MONTHS.includes(m[1])) return pick(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[1]) + 1, Number(m[2]));
  // "9/10", "09/10/2026", "9-10-26" (UK order: day first)
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/);
  if (m) return pick(m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year, Number(m[2]), Number(m[1]));
  // "2026-10-09"
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return pick(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// ---------- Morning brief nudge ----------

// "Mon 12:00 – 23:00" style opening hours: is the restaurant closed all day?
export function closedOn(openingHours: Record<string, string> | null | undefined, ymd: string) {
  const name = WEEKDAY_NAMES[weekdayOf(ymd)];
  const hours = openingHours?.[name];
  return typeof hours === "string" && /closed/i.test(hours);
}

// Nudge only restaurants that use till reports (one saved in the last 14 days),
// when yesterday has no sales at all and they were open.
export function needsZNudge(input: { lastZDay: string | null; yesterdayHasSales: boolean; closedYesterday: boolean; today: string }) {
  if (!input.lastZDay || input.yesterdayHasSales || input.closedYesterday) return false;
  return daysBetween(input.lastZDay, input.today) <= 14;
}

export function nudgeLine(today: string) {
  return `🧾 No till report for yesterday (${dayLabel(addDays(today, -1))}) yet. Send a photo of it when you can.`;
}
