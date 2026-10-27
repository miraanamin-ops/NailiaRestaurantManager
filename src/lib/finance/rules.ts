// The finance forecast in the owner's words (docs/pilot-sprint.md, "Finance
// forecast"): the week's sales range, the rota's labour cost as a % of forecast
// sales against the owner's target, and what to say when there's no forecast
// (too little history) or it's held back (the back-test's error is over the
// limit). Plain code, no AI; never a made-up number.
// No imports beyond types, so it's unit-tested (tests/finance-forecast.test.ts).
import type { WeekAhead } from "@/lib/forecast/week-ahead-rules";

export const UPLOAD_TO_UNLOCK = "Upload last year's sales to unlock forecasts";

// £950, £1,240, £14.2k (under £10k: whole pounds; above: one decimal of thousands).
export function poundsShort(pence: number) {
  const pounds = pence / 100;
  if (Math.abs(pounds) >= 10_000) return `£${(Math.round(pounds / 100) / 10).toFixed(1)}k`;
  return `£${Math.round(pounds).toLocaleString("en-GB")}`;
}

export const pct1 = (n: number) => `${Math.round(n * 10) / 10}%`;

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const shortDay = (ymd: string) => DAY_NAMES[weekdayOf(ymd)];
export const longDay = (ymd: string) => DAY_LONG[weekdayOf(ymd)];

// ---------- Labour ----------

export type LabourWeek = {
  status: "approved" | "published" | "draft" | "none"; // which rota it's from (none: no rota that week)
  costPence: number;
  hours: number;
  byDay: Record<string, number>; // date -> cost, pence
  missingRates: number; // shifts with nobody's pay rate (left out of the cost)
};

// Labour % of sales, one decimal (null without sales).
export function labourPctOf(costPence: number, salesPence: number | null | undefined) {
  return salesPence && salesPence > 0 ? Math.round((costPence / salesPence) * 1000) / 10 : null;
}

// "target 28% ✅" / "target 28%: 3.1 points over ⚠️" / a prompt to set one.
export function againstTarget(pct: number, target: number | null) {
  if (target === null) return { text: "no target set (text *labour target 30%* to set one)", over: null };
  const diff = Math.round((pct - target) * 10) / 10;
  if (diff <= 0) return { text: `target ${pct1(target)} ✅`, over: false };
  return { text: `target ${pct1(target)}: ${diff} point${diff === 1 ? "" : "s"} over ⚠️`, over: true };
}

const rotaWord = (s: LabourWeek["status"]) => (s === "draft" ? "draft rota" : "rota");

// The labour line for a week: the rota's cost, as a % of forecast sales (only
// the days with a forecast) against the target.
export function labourLine(labour: LabourWeek, ahead: Pick<WeekAhead, "show_ranges" | "days"> | null, target: number | null) {
  if (labour.status === "none") return "No rota for this week yet: text *ROTA* to see where it's up to.";
  const cost = `${rotaWord(labour.status)[0].toUpperCase()}${rotaWord(labour.status).slice(1)} ${poundsShort(labour.costPence)}`;
  const days = ahead?.show_ranges ? ahead.days.filter((d) => d.sales_mid !== null) : [];
  if (!days.length) return `${cost} (no forecast to compare it with)`;
  const sales = days.reduce((n, d) => n + d.sales_mid!, 0);
  const costOnDays = days.reduce((n, d) => n + (labour.byDay[d.date] ?? 0), 0);
  const pct = labourPctOf(costOnDays, sales)!;
  const over = days.length < 7 ? ` (the ${days.length} days with a forecast)` : "";
  return `${cost} = ${pct1(pct)} of forecast sales${over} · ${againstTarget(pct, target).text}`;
}

// ---------- The week's forecast ----------

// The sales line for a week, or why there isn't one. url: where to upload sales.
export function forecastLine(ahead: WeekAhead, uploadUrl: string) {
  if (ahead.status === "not_enough_history") return `📈 ${UPLOAD_TO_UNLOCK}: ${uploadUrl}`;
  if (ahead.status === "held_back") {
    const a = ahead.accuracy;
    return a?.error_pct != null
      ? `Forecast held back: tested on your past weeks it was off by ${pct1(a.error_pct)} on average, over the ${pct1(a.limit_pct)} limit. It shows again once it's accurate enough.`
      : "Forecast held back: there isn't enough history yet to test how accurate it is.";
  }
  if (ahead.status === "past") return null;
  const days = ahead.days.filter((d) => d.sales_mid !== null);
  if (!days.length) return null;
  const sum = (k: "sales_low" | "sales_mid" | "sales_high") => days.reduce((n, d) => n + d[k]!, 0);
  const orders = days.reduce((n, d) => n + (d.orders ?? 0), 0);
  const which = days.length < 7 ? ` (${days.length} days left)` : "";
  return `Sales forecast${which} ${poundsShort(sum("sales_low"))}–${poundsShort(sum("sales_high"))}, likely ${poundsShort(sum("sales_mid"))} from about ${orders} orders${ahead.unvalidated ? " _(TEST: unvalidated)_" : ""}`;
}

// The brief's Monday block: this week's forecast and labour. No rota this week:
// no labour line here (the report's Next week says so), so an owner who doesn't
// use the rota isn't told every Monday. Nothing to say: no block.
export function financeBlock(input: { ahead: WeekAhead; labour: LabourWeek; target: number | null; uploadUrl: string }) {
  const lines: string[] = [];
  const f = forecastLine(input.ahead, input.uploadUrl);
  if (f) lines.push(f);
  if (input.labour.status !== "none") lines.push(labourLine(input.labour, input.ahead, input.target));
  return lines.length ? ["💷 *This week*", ...lines].join("\n") : null;
}

// ---------- Last week (the report) ----------

export type LastWeekDay = { date: string; sales_low: number | null; sales_mid: number | null; sales_high: number | null; actual_pence: number | null };

// Last week's sales against what the forecast said that Monday, the labour %
// (the rota's cost over actual sales) and the best and worst day.
export function lastWeekSummary(days: LastWeekDay[], labour: LabourWeek, target: number | null) {
  const withActual = days.filter((d) => d.actual_pence !== null && d.actual_pence > 0);
  const actual = withActual.reduce((n, d) => n + d.actual_pence!, 0);
  const both = withActual.filter((d) => d.sales_mid !== null);
  const forecast = both.reduce((n, d) => n + d.sales_mid!, 0);
  const low = both.reduce((n, d) => n + d.sales_low!, 0);
  const high = both.reduce((n, d) => n + d.sales_high!, 0);
  const inside = both.filter((d) => d.actual_pence! >= d.sales_low! && d.actual_pence! <= d.sales_high!).length;
  const sorted = [...withActual].sort((a, b) => b.actual_pence! - a.actual_pence!);
  const labourPct = labour.status !== "none" ? labourPctOf(labour.costPence, actual) : null;
  return {
    actual: withActual.length ? actual : null,
    forecast: both.length ? { mid: forecast, low, high, days: both.length, inside, vsPct: forecast ? Math.round(((actual - forecast) / forecast) * 1000) / 10 : null } : null,
    best: sorted[0] ? { date: sorted[0].date, pence: sorted[0].actual_pence! } : null,
    worst: sorted.length > 1 ? { date: sorted.at(-1)!.date, pence: sorted.at(-1)!.actual_pence! } : null,
    labourPct,
    target: labourPct !== null ? againstTarget(labourPct, target) : null,
  };
}

export function lastWeekLines(s: ReturnType<typeof lastWeekSummary>, labour: LabourWeek) {
  const lines: string[] = [];
  if (s.actual === null) return ["No sales figures for last week yet."];
  if (s.forecast) {
    const dir = s.forecast.vsPct === null || Math.abs(s.forecast.vsPct) < 1 ? "on" : s.forecast.vsPct > 0 ? `${pct1(s.forecast.vsPct)} above` : `${pct1(-s.forecast.vsPct)} below`;
    lines.push(`Sales ${poundsShort(s.actual)}: ${dir} forecast (${poundsShort(s.forecast.mid)}, range ${poundsShort(s.forecast.low)}–${poundsShort(s.forecast.high)}); ${s.forecast.inside} of ${s.forecast.days} days inside their range.`);
  } else lines.push(`Sales ${poundsShort(s.actual)} (no forecast for last week to compare with).`);
  if (labour.status === "none") lines.push("Labour: no rota for last week.");
  else if (s.labourPct !== null) lines.push(`Labour ${poundsShort(labour.costPence)} from the ${rotaWord(labour.status)} = ${pct1(s.labourPct)} of sales · ${s.target!.text}`);
  if (s.best) lines.push(`Best day: ${longDay(s.best.date)} ${poundsShort(s.best.pence)}${s.worst ? ` · worst: ${longDay(s.worst.date)} ${poundsShort(s.worst.pence)}` : ""}`);
  return lines;
}
