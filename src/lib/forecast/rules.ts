// The forecast as the owner sees it: which run to use, rounding, reasons, the
// "Yesterday" line, the days-ahead flags, the quiet-night offer and every word of
// the brief's forecast block. Pure code, unit-tested (tests/forecast.test.ts).
// Every number here comes from the forecast data or the restaurant's own sales;
// Claude never writes or changes one. No staffing advice: busy days are
// information only until the rota slice.
import { dayLabel, gbp, weekdayOf, WEEKDAY_NAMES, daysBetween } from "@/lib/sales/format";
import { quotedNumbers } from "@/lib/agents/insights-rules";
import { factorWords } from "./factors";

// ---------- Settings (one place) ----------

export const FORECAST_CONFIG = {
  quietPct: -20, // a day is quiet if its likely orders are at least 20% below a normal day of that weekday
  busyPct: 20, // and busy if at least 20% above
  normalWeeks: 8, // a normal day: the median of the last 8 same weekdays (unusual and closed days left out)
  normalMinDays: 4, // fewer usable weekdays than this: no flag for that weekday
  flagDaysAhead: 7, // flags look at the next 7 days
  maxFlags: 2,
  offerFromDays: 3, // the quiet-night offer: a quiet day 3 to 7 days ahead
  offerToDays: 7,
  maxReasons: 3,
  minReasonPct: 3, // smaller effects aren't worth a reason
  coversWindowDays: 28, // covers show only if recorded on 20 of the last 28 days
  coversMinDays: 20,
  recentDays: 14, // "had a forecast recently": a usable run in the last 14 days
  lookUpDays: 14, // the assistant answers up to 14 days ahead
} as const;

export const DAILY_MODEL = "forecast_daily"; // 05:35 UK
export const REFRESH_MODEL = "forecast_refresh"; // 07:00 UK
export const FORECAST_MODELS = [DAILY_MODEL, REFRESH_MODEL] as const;

export const TEST_LABEL = "TEST: unvalidated forecast";
export const FOOTNOTE = "_Forecasts are information, not financial advice._";
export const FOOTNOTE_SHORT = "_Forecast: information, not financial advice._";

// ---------- Which run ----------

export type RunInfo = {
  id: string;
  model_name: string;
  role: string;
  status: string;
  passed: boolean | null;
  started_at: string;
  metrics: unknown;
};

export type UsableRun = { run: RunInfo; unvalidated: boolean };

// Today's runs that may be used, best first: the 07:00 refresh if it passed, then
// the 05:35 run. With the demo override, runs that succeeded but didn't pass too
// (labelled TEST), after any that passed. Benchmarks and failed runs never.
export function usableRuns(todays: RunInfo[], unvalidatedAllowed: boolean): UsableRun[] {
  const ok = todays.filter((r) => r.role === "production" && r.status === "succeeded" && FORECAST_MODELS.includes(r.model_name as never));
  const order = (r: RunInfo) => (r.model_name === REFRESH_MODEL ? 0 : 1);
  const sorted = [...ok].sort((a, b) => order(a) - order(b) || b.started_at.localeCompare(a.started_at));
  const passed = sorted.filter((r) => r.passed === true).map((run) => ({ run, unvalidated: false }));
  const test = unvalidatedAllowed ? sorted.filter((r) => r.passed !== true).map((run) => ({ run, unvalidated: true })) : [];
  return [...passed, ...test];
}

// Why there's no forecast today, for the builder's alert (never the owner).
export function noForecastReason(todays: RunInfo[]) {
  const runs = todays.filter((r) => r.role === "production" && FORECAST_MODELS.includes(r.model_name as never));
  if (!runs.length) return "no forecast run today (is ANALYTICS_JOBS on and the Railway worker running?)";
  const daily = runs.filter((r) => r.model_name === DAILY_MODEL);
  const latest = (daily.length ? daily : runs).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  const name = latest.model_name === REFRESH_MODEL ? "the 07:00 refresh" : "the 05:35 run";
  if (latest.status === "failed") return `${name} failed`;
  if (latest.status === "running") return `${name} was still running at brief time`;
  if (latest.status === "succeeded" && latest.passed !== true) {
    const failed = failedChecks(latest.metrics);
    return `${name} didn't pass its back-test${failed.length ? `: ${failed.join("; ")}` : ""}`;
  }
  return `${name} ended as ${latest.status}`;
}

type PassCheck = { check?: unknown; ok?: unknown };
function passOf(metrics: unknown): { checks: PassCheck[]; deciding: string[] } {
  const pass = (metrics as { pass?: { checks?: unknown; deciding_channels?: unknown } } | null)?.pass;
  return {
    checks: Array.isArray(pass?.checks) ? (pass.checks as PassCheck[]) : [],
    deciding: Array.isArray(pass?.deciding_channels) ? (pass.deciding_channels as unknown[]).filter((c): c is string => typeof c === "string") : [],
  };
}

export function failedChecks(metrics: unknown) {
  return passOf(metrics)
    .checks.filter((c) => c.ok !== true && typeof c.check === "string")
    .map((c) => c.check as string);
}

// The channels that get their own line: the model counted them (15% of orders or
// more, its deciding channels) and every check of theirs passed. The metrics are the
// 05:35 run's (a refresh carries no pass details of its own).
export function channelsToShow(metrics: unknown) {
  const { checks, deciding } = passOf(metrics);
  return deciding
    .filter((ch) => ch !== "all")
    .filter((ch) => {
      const mine = checks.filter((c) => typeof c.check === "string" && (c.check as string).startsWith(`orders/${ch} `));
      return mine.length > 0 && mine.every((c) => c.ok === true);
    });
}

export const CHANNEL_NAMES: Record<string, string> = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

// Covers only when the restaurant records them: on 20 of the last 28 days.
export function coversRecorded(days: { day: string; covers: number | null }[], today: string) {
  const recent = days.filter((d) => d.day < today && daysBetween(d.day, today) <= FORECAST_CONFIG.coversWindowDays && d.covers !== null);
  return recent.length >= FORECAST_CONFIG.coversMinDays;
}

// What the brief says: a forecast, "No forecast today" (it had one recently), or nothing.
export function forecastStatus(input: { haveToday: boolean; hadRecently: boolean }): "shown" | "no_forecast" | "none" {
  if (input.haveToday) return "shown";
  return input.hadRecently ? "no_forecast" : "none";
}

// ---------- Rounding (always outward for ranges) ----------

export type Range = { low: number; likely: number; high: number };

const down = (n: number, step: number) => Math.floor(n / step) * step;
const up = (n: number, step: number) => Math.ceil(n / step) * step;
const near = (n: number, step: number) => Math.round(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Orders (and covers) to the nearest 5.
export function roundCount(r: Range): Range {
  const low = Math.max(0, down(r.low, 5));
  const high = Math.max(low, up(r.high, 5));
  return { low, likely: clamp(near(r.likely, 5), low, high), high };
}

// Pence in, pence out: £10 steps under £1,000 and £50 from £1,000.
export function moneyStep(pence: number) {
  return pence < 100_000 ? 1_000 : 5_000;
}
export function roundSales(r: Range): Range {
  const low = Math.max(0, down(r.low, moneyStep(r.low)));
  const high = Math.max(low, up(r.high, moneyStep(r.high)));
  return { low, likely: clamp(near(r.likely, moneyStep(r.likely)), low, high), high };
}

export const pounds = (pence: number) => gbp(Math.round(pence / 100));

// ---------- Reasons ----------

export type Driver = { factor: string; multiplier: number };
export type Reason = { factor: string; words: string; pct: number };

// The top reasons for one day, in owner words, with their % effect. Weekday and
// season are never reasons on their own; unknown factors are left out.
export function reasonsFor(drivers: Driver[], input: { today: boolean; dealNames?: Map<string, string> }, max: number = FORECAST_CONFIG.maxReasons): Reason[] {
  const out: Reason[] = [];
  const sorted = [...drivers].filter((d) => d.multiplier > 0).sort((a, b) => Math.abs(Math.log(b.multiplier)) - Math.abs(Math.log(a.multiplier)));
  for (const d of sorted) {
    const id = d.factor.startsWith("deal:") ? d.factor.slice(5) : null;
    const words = factorWords(d.factor, { today: input.today, multiplier: d.multiplier, dealName: id ? input.dealNames?.get(id) : null });
    if (!words) continue;
    const pct = Math.round((d.multiplier - 1) * 100);
    if (Math.abs(pct) < FORECAST_CONFIG.minReasonPct) continue;
    if (out.some((r) => r.words === words)) continue;
    out.push({ factor: d.factor, words, pct });
    if (out.length >= max) break;
  }
  return out;
}

export const signedPct = (pct: number) => `${pct > 0 ? "+" : "-"}${Math.abs(pct)}%`;

export function whyLine(reasons: Reason[]) {
  return reasons.length ? `Why: ${reasons.map((r) => `${r.words} (${signedPct(r.pct)})`).join(", ")}` : null;
}

// ---------- A normal day, and the days-ahead flags ----------

export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A normal day of the target's weekday: the median orders of the last 8 same weekdays
// before today, leaving out unusual days (restaurant events marked unusual) and
// days with no orders (closed). Too few: null (no flag).
export function normalDay(target: string, today: string, history: { day: string; orders: number | null }[], unusual: Set<string>) {
  const wd = weekdayOf(target);
  const days = history
    .filter((h) => h.day < today && weekdayOf(h.day) === wd && !unusual.has(h.day) && (h.orders ?? 0) > 0)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, FORECAST_CONFIG.normalWeeks);
  if (days.length < FORECAST_CONFIG.normalMinDays) return null;
  return median(days.map((d) => d.orders as number));
}

export type Flag = { day: string; offset: number; kind: "quiet" | "busy"; pct: number; likely: number; normal: number; reason: string | null };

// Quiet or busy days in the next 7 (at most 2, the biggest differences, in date order).
export function daysAheadFlags(today: string, days: { day: string; likely: number; reasons: Reason[] }[], normals: Map<string, number | null>): Flag[] {
  const flags: Flag[] = [];
  for (const d of days) {
    const offset = daysBetween(today, d.day);
    if (offset < 1 || offset > FORECAST_CONFIG.flagDaysAhead) continue;
    const normal = normals.get(d.day);
    if (!normal) continue;
    const pct = (d.likely / normal - 1) * 100;
    const kind = pct <= FORECAST_CONFIG.quietPct ? "quiet" : pct >= FORECAST_CONFIG.busyPct ? "busy" : null;
    if (!kind) continue;
    const main = d.reasons.find((r) => (kind === "busy" ? r.pct > 0 : r.pct < 0));
    flags.push({ day: d.day, offset, kind, pct: Math.round(pct), likely: d.likely, normal, reason: main?.words ?? null });
  }
  return flags
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.day.localeCompare(b.day))
    .slice(0, FORECAST_CONFIG.maxFlags)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export const weekdayName = (ymd: string) => WEEKDAY_NAMES[weekdayOf(ymd)];

// "Thursday 5 Nov"
export function longDay(ymd: string) {
  return `${weekdayName(ymd)} ${dayLabel(ymd).split(" ").slice(1).join(" ")}`;
}

// "Tomorrow", "Thursday", "Next Tuesday" (7 days on is today's weekday).
export function dayName(offset: number, ymd: string) {
  if (offset === 1) return "Tomorrow";
  if (offset === 7) return `Next ${weekdayName(ymd)}`;
  return weekdayName(ymd);
}

// "about 25%": the difference to the nearest 5.
const aboutPct = (pct: number) => Math.max(5, Math.round(Math.abs(pct) / 5) * 5);

export function flagSentence(f: Flag) {
  const more = f.kind === "busy" ? "busier" : "quieter";
  return `${dayName(f.offset, f.day)} looks about ${aboutPct(f.pct)}% ${more} than a normal ${weekdayName(f.day)}${f.reason ? `, mainly ${f.reason}` : ""}.`;
}

export function daysAheadLine(flags: Flag[]) {
  return flags.length ? `Days ahead: ${flags.map(flagSentence).join(" ")}` : null;
}

// ---------- The quiet-night offer ----------

// The first listed quiet day 3 to 7 days ahead.
export function offerDay(flags: Flag[]) {
  return flags.find((f) => f.kind === "quiet" && f.offset >= FORECAST_CONFIG.offerFromDays && f.offset <= FORECAST_CONFIG.offerToDays) ?? null;
}

const near5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

// The message that comes with the "Draft an offer" / "Not now" buttons.
export function offerQuestion(f: Flag) {
  return `📉 ${longDay(f.day)} looks quiet: likely about ${near5(f.likely)} orders, against about ${near5(f.normal)} on a normal ${weekdayName(f.day)}. Shall I draft an offer email for that day? You'll see it before anything goes out.`;
}

// When the 7-day gap means nobody could get it.
export function offerBlockedLine(f: Flag, lastSent: string | null) {
  const when = lastSent ? `on ${dayLabel(lastSent)}` : "in the last 7 days";
  return `Everyone on your list had an offer email ${when}, and nobody gets more than one a week, so I can't send one for ${weekdayName(f.day)}.`;
}

// What the campaign writer is asked for (every number from code).
export function offerRequest(f: Flag) {
  return `${longDay(f.day)} (${f.day}) looks quiet: the forecast is about ${near5(f.likely)} orders, against about ${near5(f.normal)} on a normal ${weekdayName(f.day)} (about ${aboutPct(f.pct)}% fewer)${f.reason ? `, mainly ${f.reason}` : ""}. Write an offer email to bring customers in on that day only: valid_from and valid_until both ${f.day}, segment everyone. Keep the offer within the discount cap.`;
}

// ---------- Yesterday ----------

export type ShownRange = { orders_low: number | null; orders_high: number | null };

// Yesterday's orders against the range shown in yesterday's brief.
export function yesterdayLine(shown: ShownRange | null, actualOrders: number | null) {
  if (!shown || shown.orders_low === null || shown.orders_high === null || actualOrders === null) return null;
  const range = `(${shown.orders_low} to ${shown.orders_high})`;
  const where = actualOrders < shown.orders_low ? `below the forecast ${range}` : actualOrders > shown.orders_high ? `above the forecast ${range}` : `inside the forecast ${range} ✓`;
  return `Yesterday: ${actualOrders} orders, ${where}`;
}

// ---------- The block ----------

export type BlockInput = {
  status: "shown" | "no_forecast" | "none";
  today: string;
  unvalidated: boolean;
  orders: Range | null; // rounded
  sales: Range | null; // rounded, pence before VAT
  channels: { channel: string; range: Range }[]; // rounded
  covers: Range | null; // rounded
  reasons: Reason[];
  yesterday: string | null;
  flags: Flag[];
  blockedOffer: string | null;
  footnote: boolean;
};

export function headline(input: Pick<BlockInput, "today" | "unvalidated" | "orders" | "sales">) {
  const label = `Today, ${dayLabel(input.today)}${input.unvalidated ? ` (${TEST_LABEL})` : ""}`;
  const parts: string[] = [];
  if (input.orders) parts.push(`likely ${input.orders.likely} orders (${input.orders.low} to ${input.orders.high})`);
  if (input.sales) parts.push(input.orders ? `about ${pounds(input.sales.likely)} before VAT` : `about ${pounds(input.sales.likely)} before VAT (${pounds(input.sales.low)} to ${pounds(input.sales.high)})`);
  return `📈 *${label}:* ${parts.join(", ")}`;
}

// The forecast lines of the 9am brief. The same text on the GM's brief and today's.
export function composeForecastBlock(input: BlockInput): string | null {
  if (input.status === "none") return null;
  if (input.status === "no_forecast") return "📈 No forecast today.";
  if (!input.orders && !input.sales) return "📈 No forecast today.";
  const lines = [headline(input)];
  for (const c of input.channels) lines.push(`${CHANNEL_NAMES[c.channel] ?? c.channel}: likely ${c.range.likely} orders (${c.range.low} to ${c.range.high})`);
  if (input.covers) lines.push(`Covers: likely ${input.covers.likely} (${input.covers.low} to ${input.covers.high})`);
  const why = whyLine(input.reasons);
  if (why) lines.push(why);
  if (input.yesterday) lines.push(input.yesterday);
  const ahead = daysAheadLine(input.flags);
  if (ahead) lines.push(ahead);
  if (input.blockedOffer) lines.push(input.blockedOffer);
  if (input.footnote) lines.push(FOOTNOTE);
  return lines.join("\n");
}

// The footnote: the first brief that shows a forecast, then Mondays.
export function showFootnote(input: { shownBefore: boolean; londonWeekday: number }) {
  return !input.shownBefore || input.londonWeekday === 1;
}

// ---------- The assistant's answers ----------

export type LookUpDay = { day: string; orders: Range | null; sales: Range | null; reasons: Reason[]; vsNormalPct: number | null };

// One line per day, in code's words (also the fallback when Claude's answer fails the number check).
export function lookUpLines(days: LookUpDay[], unvalidated: boolean) {
  const lines = days.map((d) => {
    const parts: string[] = [];
    if (d.orders) parts.push(`likely ${d.orders.likely} orders (${d.orders.low} to ${d.orders.high})`);
    if (d.sales) parts.push(`about ${pounds(d.sales.likely)} before VAT`);
    if (d.vsNormalPct !== null && Math.abs(d.vsNormalPct) >= 10) parts.push(`about ${aboutPct(d.vsNormalPct)}% ${d.vsNormalPct > 0 ? "busier" : "quieter"} than a normal ${weekdayName(d.day)}`);
    const why = d.reasons.length ? `; why: ${d.reasons.map((r) => `${r.words} (${signedPct(r.pct)})`).join(", ")}` : "";
    return `${longDay(d.day)}: ${parts.join(", ")}${why}`;
  });
  return unvalidated ? [`(${TEST_LABEL})`, ...lines] : lines;
}

// Every figure in Claude's answer must be one code gave it (the look-up's lines).
// Small whole numbers (1 to 7: "2 days") are allowed; dates aren't figures.
export function numbersOnlyFrom(text: string, allowed: string[]) {
  const ok = allowed.flatMap((t) => quotedNumbers(t)).map((q) => q.value);
  return quotedNumbers(text).every((q) => (q.kind === "number" && Number.isInteger(q.value) && q.value >= 1 && q.value <= 7) || ok.some((v) => Math.abs(v - q.value) < 0.005));
}

// Busy days are information only until the rota slice: an answer that talks about
// staff, rotas or shifts falls back to code's own lines.
const STAFFING = /\b(staff|staffing|rota|rotas|shifts?|extra hands|hire|hiring|wages?|labour)\b/i;
export function mentionsStaffing(text: string) {
  return STAFFING.test(text);
}

// ---------- The Monday report ----------

export type ReportDay = { day: string; low: number; high: number; actual: number };

export function forecastWeek(days: ReportDay[]) {
  const rows = days.map((d) => ({ ...d, inside: d.actual >= d.low && d.actual <= d.high }));
  return { rows, inside: rows.filter((r) => r.inside).length, total: rows.length };
}
