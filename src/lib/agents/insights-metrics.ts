// query_metrics: every figure the Insights agent uses is worked out here, in
// plain code, never by the model (insights.md: "You explain numbers; you never
// calculate them"). Each result says what it measures, over which period,
// compared with what, where the figures came from, and whether the sample is
// too small to read much into. No app imports (zod and the sales date helpers
// only), so every figure is unit-tested against the saved test data
// (tests/agents/insights-metrics.test.ts).
import { z } from "zod";
import { addDays, dayLabel, daysBetween, WEEKDAY_NAMES, weekdayOf } from "@/lib/sales/format";

// ---------- The data (one restaurant) ----------

export type MetricsData = {
  // The restaurant's own London date, "YYYY-MM-DD". Periods are counted back from it.
  today: string;
  sales_days: { day: string; net: number; gross: number | null; transactions: number | null; source: string; net_estimated?: boolean; dummy?: boolean }[];
  sales_hours: { day: string; hour: number; sales: number }[];
  sales_items: { day: string; item: string; quantity: number; amount: number }[];
  weather: { day: string; temp_max: number | null; temp_min: number | null; rain_mm: number | null; conditions: string | null }[];
  reviews: { date: string; rating: number | null; replied_at: string | null }[];
  // Sign-up times (ISO).
  signups: string[];
  campaigns: { id: string; name: string; offer: string | null; segment: string | null; is_birthday: boolean; sent_at: string | null; valid_from: string | null; valid_until: string | null }[];
  sends: { campaign_id: string; delivery: string; sent_at: string; opened_at: string | null; clicked_at: string | null; redeemed_at: string | null }[];
  rewards: { created_at: string; redeemed_at: string | null }[];
  // Profile figures Insights may need (insights.md "What you're given"); none are stored yet.
  dish_costs?: Record<string, number> | null;
  sales_target?: number | null;
  // Google views, calls and direction requests. Null = Google isn't connected (dummy mode).
  google?: { day: string; views: number; calls: number; directions: number }[] | null;
  // The week ahead (lib/forecast/week-ahead.ts) for this week and next, in pounds.
  // status: ok, or why there are no numbers to show (not_enough_history, held_back).
  forecast_weeks?: {
    week_start: string;
    status: "ok" | "not_enough_history" | "held_back" | "past";
    unvalidated: boolean;
    source: string;
    error_pct: number | null;
    limit_pct: number | null;
    days: { date: string; orders: number | null; sales_low: number | null; sales_mid: number | null; sales_high: number | null }[];
  }[] | null;
  // Staff cost per week from the rota (lib/finance/labour.ts), in pounds. Null = no team yet.
  labour_weeks?: { week_start: string; status: "none" | "draft" | "approved" | "published"; cost: number; hours: number; by_day: Record<string, number>; missing_rates: number }[] | null;
  // The owner's labour target, % of sales (LABOUR TARGET 28%).
  labour_target_pct?: number | null;
};

// ---------- The question (the tool's input) ----------

export const METRICS = [
  "net_sales",
  "gross_sales",
  "transactions",
  "avg_spend",
  "sales_by_day",
  "sales_by_weekday",
  "sales_by_hour",
  "item_sales",
  "weather",
  "rain_vs_dry",
  "reviews",
  "list_growth",
  "campaign_results",
  "google_stats",
  "covers",
  "dish_margins",
  "labour_cost",
  "sales_target",
  "sales_forecast",
] as const;
export type Metric = (typeof METRICS)[number];

export const PERIODS = ["yesterday", "this_week", "next_week", "last_week", "week_before_last", "last_4_weeks", "last_8_weeks", "last_12_weeks", "last_month", "last_12_months", "day", "custom"] as const;
export const COMPARES = ["none", "previous_period", "same_weekday_last_4", "average_of_previous_4_weeks", "same_period_last_year"] as const;

export const MetricQuery = z.object({
  metric: z.enum(METRICS),
  period: z.enum(PERIODS).describe("Weeks run Monday to Sunday. next_week = the coming Monday to Sunday (sales_forecast, labour_cost); this_week for sales_forecast or labour_cost = the whole week, today included; last_week = the last full week; last_month = the last full calendar month; day = one date (set date)."),
  date: z.string().nullable().describe("YYYY-MM-DD, only for period day"),
  from: z.string().nullable().describe("YYYY-MM-DD, only for period custom"),
  to: z.string().nullable().describe("YYYY-MM-DD (inclusive), only for period custom"),
  weekday: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]).nullable().describe("Only count this day of the week within the period (e.g. last_week + Saturday = last Saturday)"),
  compare: z.enum(COMPARES).describe("same_weekday_last_4: the average of the same weekday in the 4 weeks before; average_of_previous_4_weeks: the average of the 4 periods of the same length before"),
  campaign: z.string().nullable().describe("campaign_results only: the campaign's name or id; null = campaigns sent in the period"),
});
export type MetricQueryInput = z.infer<typeof MetricQuery>;

// ---------- The answer ----------

export type Unit = "GBP" | "count" | "percent" | "stars" | "celsius" | "mm";
export type Figure = { value: number; unit: Unit; display: string };
export type Row = { label: string } & Figure & { extra?: Record<string, Figure | string> };

export type MetricResult =
  | {
      id: string;
      available: true;
      metric: Metric;
      label: string;
      period: { from: string; to: string; label: string };
      value: Figure | null;
      compare: (Figure & { label: string; period: { from: string; to: string }; change_pct: number | null; change_display: string | null }) | null;
      rows: Row[];
      days_with_data: number | null;
      source: string;
      small_sample: string | null;
      anomalies: { day: string; label: string; value: Figure; usual: Figure; times: number; source: string }[];
      notes: string[];
    }
  | { id: string; available: false; metric: Metric; missing: string; how_to_get: string };

// ---------- Numbers in words ----------

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number): Figure => {
  const v = round(n, 2);
  const abs = Math.abs(v);
  // Round for reading (insights.md): £8,420 not £8,419.62; pence only under £100.
  const display = abs >= 100 ? `£${Math.round(abs).toLocaleString("en-GB")}` : `£${abs.toFixed(2)}`;
  return { value: v, unit: "GBP", display: v < 0 ? `-${display}` : display };
};
const count = (n: number): Figure => ({ value: round(n, 1), unit: "count", display: Number.isInteger(round(n, 1)) ? round(n, 1).toLocaleString("en-GB") : round(n, 1).toFixed(1) });
const stars = (n: number): Figure => ({ value: round(n, 1), unit: "stars", display: round(n, 1).toFixed(1) });
const pct = (n: number): Figure => ({ value: Math.round(n), unit: "percent", display: `${Math.round(n)}%` });
const celsius = (n: number): Figure => ({ value: round(n, 1), unit: "celsius", display: `${round(n, 1)}°C` });
const mm = (n: number): Figure => ({ value: round(n, 1), unit: "mm", display: `${round(n, 1)}mm` });

export function changePct(now: number, before: number) {
  return before ? Math.round(((now - before) / Math.abs(before)) * 100) : null;
}
const changeDisplay = (p: number | null) => (p === null ? null : p === 0 ? "no change" : `${p > 0 ? "up" : "down"} ${Math.abs(p)}%`);

function rangeLabel(from: string, to: string) {
  const year = Number(to.slice(0, 4));
  return from === to ? dayLabel(from, year) : `${dayLabel(from, year)} to ${dayLabel(to, year)}`;
}

// ---------- Periods ----------

type Range = { from: string; to: string };
const mondayOf = (ymd: string) => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
const daysIn = (r: Range) => Array.from({ length: daysBetween(r.from, r.to) + 1 }, (_, i) => addDays(r.from, i));
const shift = (r: Range, days: number): Range => ({ from: addDays(r.from, days), to: addDays(r.to, days) });

export function periodRange(q: Pick<MetricQueryInput, "period" | "date" | "from" | "to"> & { metric?: Metric }, today: string): Range {
  const yesterday = addDays(today, -1);
  const thisMonday = mondayOf(today);
  switch (q.period) {
    case "yesterday":
      return { from: yesterday, to: yesterday };
    case "this_week":
      // The week ahead (forecast, rota) covers the whole week; sales so far stop at yesterday.
      if (q.metric === "sales_forecast" || q.metric === "labour_cost") return { from: thisMonday, to: addDays(thisMonday, 6) };
      return { from: thisMonday, to: today === thisMonday ? today : yesterday };
    case "next_week":
      return { from: addDays(thisMonday, 7), to: addDays(thisMonday, 13) };
    case "last_week":
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
    case "week_before_last":
      return { from: addDays(thisMonday, -14), to: addDays(thisMonday, -8) };
    case "last_4_weeks":
      return { from: addDays(thisMonday, -28), to: addDays(thisMonday, -1) };
    case "last_8_weeks":
      return { from: addDays(thisMonday, -56), to: addDays(thisMonday, -1) };
    case "last_12_weeks":
      return { from: addDays(thisMonday, -84), to: addDays(thisMonday, -1) };
    case "last_month": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    case "last_12_months":
      return { from: addDays(today, -365), to: yesterday };
    case "day":
      if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw new QueryError("period day needs date as YYYY-MM-DD");
      return { from: q.date, to: q.date };
    case "custom":
      if (!q.from || !q.to || !/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) throw new QueryError("period custom needs from and to as YYYY-MM-DD, from on or before to");
      return { from: q.from, to: q.to };
  }
}

export class QueryError extends Error {}

// The forecast's days within a list of dates (today and later), or why there are none.
type ForecastDay = { date: string; orders: number | null; sales_low: number; sales_mid: number; sales_high: number };
type ForecastDays = { days: ForecastDay[]; skipped: number; unvalidated: boolean; source: string } | { missing: string; how_to_get: string };

function forecastDays(data: MetricsData, dates: string[]): ForecastDays {
  const weeks = data.forecast_weeks ?? [];
  const wanted = dates.filter((d) => d >= data.today);
  const found: ForecastDay[] = [];
  let skipped = dates.length - wanted.length;
  let unvalidated = false;
  const sources = new Set<string>();
  for (const d of wanted) {
    const week = weeks.find((w) => d >= w.week_start && d <= addDays(w.week_start, 6));
    if (week?.status === "not_enough_history") return { missing: "enough sales history for a forecast", how_to_get: "Forecasts need at least 8 whole weeks of sales. Upload last year's sales (settings) or send end-of-day till reports, and the week ahead appears once there are 8 weeks." };
    if (week?.status === "held_back") {
      return { missing: "a forecast accurate enough to show", how_to_get: `Tested on this restaurant's past weeks, the forecast was off by ${week.error_pct ?? "more than"}% on average, over the ${week.limit_pct ?? 20}% limit, so its figures are held back until it's more accurate.` };
    }
    const day = week?.days.find((x) => x.date === d);
    if (!week || !day || day.sales_mid === null || day.sales_low === null || day.sales_high === null) {
      skipped++;
      continue;
    }
    unvalidated ||= week.unvalidated;
    sources.add(week.source);
    found.push({ date: d, orders: day.orders, sales_low: day.sales_low, sales_mid: day.sales_mid, sales_high: day.sales_high });
  }
  if (!found.length) return { missing: "a forecast for those days", how_to_get: "There's a forecast for this week and next only, and only for days that haven't happened yet." };
  return { days: found, skipped, unvalidated, source: [...sources].map((s) => (s === "forecast" ? "the nightly forecast" : s === "history" ? "the same weekday over the last 8 weeks" : s)).join(" and ") };
}

const WEEKDAY_INDEX = (name: string) => WEEKDAY_NAMES.indexOf(name);

// The days of a range that count (all, or one weekday).
function countedDays(r: Range, weekday: string | null) {
  return daysIn(r).filter((d) => !weekday || weekdayOf(d) === WEEKDAY_INDEX(weekday));
}

// ---------- Sales helpers ----------

type SalesDay = MetricsData["sales_days"][number];
const SOURCE_WORDS: Record<string, string> = { seed: "dummy data", z_report: "till reports", pos: "POS files" };

function sourceOf(days: SalesDay[]) {
  const kinds = [...new Set(days.map((d) => SOURCE_WORDS[d.source] ?? d.source))];
  return kinds.length ? kinds.join(" and ") : "no sales data";
}

// Under 4 weeks of sales data in all (up to the end of the period): early figures.
const MIN_DAYS = 28;
function salesSample(data: MetricsData, upTo: string) {
  const known = data.sales_days.filter((d) => d.day <= upTo).length;
  return known < MIN_DAYS ? `Only ${known} day${known === 1 ? "" : "s"} of sales data so far (under 4 weeks), so these are early figures.` : null;
}

// A day 2.5 times (or under 0.4 times) the usual for that weekday (the median of the
// same weekday in the 8 weeks before, at least 3 of them): possibly a misread till report.
export function anomaliesIn(data: MetricsData, days: string[]) {
  const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
  const out: Extract<MetricResult, { available: true }>["anomalies"] = [];
  for (const day of days) {
    const d = byDay.get(day);
    if (!d || d.net <= 0) continue;
    const before = Array.from({ length: 8 }, (_, i) => byDay.get(addDays(day, -7 * (i + 1))))
      .filter((x): x is SalesDay => Boolean(x) && x!.net > 0)
      .map((x) => x.net)
      .sort((a, b) => a - b);
    if (before.length < 3) continue;
    const usual = before.length % 2 ? before[(before.length - 1) / 2] : (before[before.length / 2 - 1] + before[before.length / 2]) / 2;
    const times = d.net / usual;
    if (times >= 2.5 || times <= 0.4) {
      out.push({ day, label: dayLabel(day, Number(day.slice(0, 4))), value: money(d.net), usual: money(usual), times: round(times, 1), source: SOURCE_WORDS[d.source] ?? d.source });
    }
  }
  return out;
}

type SalesFn = (days: SalesDay[]) => number | null;
const sumNet: SalesFn = (ds) => (ds.length ? round(ds.reduce((s, d) => s + d.net, 0)) : null);
const sumGross: SalesFn = (ds) => {
  const known = ds.filter((d) => d.gross !== null);
  return known.length ? round(known.reduce((s, d) => s + (d.gross ?? 0), 0)) : null;
};
const sumTransactions: SalesFn = (ds) => {
  const known = ds.filter((d) => d.transactions !== null);
  return known.length ? known.reduce((s, d) => s + (d.transactions ?? 0), 0) : null;
};
const avgSpend: SalesFn = (ds) => {
  const known = ds.filter((d) => d.transactions);
  const t = known.reduce((s, d) => s + (d.transactions ?? 0), 0);
  return t ? round(known.reduce((s, d) => s + d.net, 0) / t) : null;
};

// "quiet tuesday deal" finds "Quiet Tuesday grill deal": every word the owner used, in any order.
export function nameMatches(name: string, wanted: string) {
  const words = wanted.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !CAMPAIGN_FILLER.has(w));
  const have = name.toLowerCase();
  return words.length > 0 && words.every((w) => have.includes(w));
}
const CAMPAIGN_FILLER = new Set(["the", "our", "my", "campaign", "offer", "email"]);

// ---------- Running a query ----------

export function queryMetrics(data: MetricsData, q: MetricQueryInput, id: string): MetricResult {
  const unavailable = (missing: string, how_to_get: string): MetricResult => ({ id, available: false, metric: q.metric, missing, how_to_get });

  switch (q.metric) {
    case "covers":
      return unavailable(
        "covers (how many people ate)",
        "Till reports and POS files here record transactions (the number of bills), not covers. Ask for transactions instead, or add a covers line to the end-of-day till report.",
      );
    case "dish_margins":
      if (!data.dish_costs || !Object.keys(data.dish_costs).length) return unavailable("dish costs", "Send the cost to make each dish (ingredients per plate), and margins can be worked out from item sales.");
      return unavailable("dish margins", "Menu engineering isn't in this version yet.");
    case "sales_target":
      if (!data.sales_target) return unavailable("a weekly sales target", "Tell me your weekly net sales target and it can be compared every week.");
      break;
  }

  const range = periodRange({ ...q, metric: q.metric }, data.today);
  const days = countedDays(range, q.weekday);
  const label = (base: string) => `${base}${q.weekday ? ` (${q.weekday}s only)` : ""}`;
  const base = {
    id,
    available: true as const,
    metric: q.metric,
    period: { ...range, label: q.weekday && days.length === 1 ? rangeLabel(days[0], days[0]) : `${rangeLabel(range.from, range.to)}${q.weekday ? `, ${q.weekday}s only` : ""}` },
    rows: [] as Row[],
    anomalies: [] as Extract<MetricResult, { available: true }>["anomalies"],
    notes: [] as string[],
    small_sample: null as string | null,
  };

  // The comparison period(s) for the same query.
  const comparison = (): { label: string; ranges: Range[]; average: boolean } | null => {
    const length = daysBetween(range.from, range.to) + 1;
    switch (q.compare) {
      case "none":
        return null;
      case "previous_period": {
        if (q.period === "last_month") {
          // The calendar month before.
          const to = addDays(range.from, -1);
          const prev = { from: `${to.slice(0, 7)}-01`, to };
          return { label: `the month before (${rangeLabel(prev.from, prev.to)})`, ranges: [prev], average: false };
        }
        const prev = shift(range, -length);
        return { label: `the ${length === 7 ? "week" : length === 1 ? "day" : "period"} before (${rangeLabel(prev.from, prev.to)})`, ranges: [prev], average: false };
      }
      case "same_weekday_last_4": {
        // The same weekday(s) in each of the 4 weeks before.
        const ranges = [1, 2, 3, 4].map((w) => shift(range, -7 * w));
        const name = q.weekday ?? (length === 1 ? WEEKDAY_NAMES[weekdayOf(range.from)] : null);
        return { label: `the average of the ${name ? `4 ${name}s` : "same days in the 4 weeks"} before`, ranges, average: true };
      }
      case "average_of_previous_4_weeks": {
        const ranges = [1, 2, 3, 4].map((w) => shift(range, -length * w));
        return { label: `the average of the 4 ${length === 7 ? "weeks" : "periods of the same length"} before (${rangeLabel(ranges[3].from, ranges[0].to)})`, ranges, average: true };
      }
      case "same_period_last_year": {
        // 52 weeks back, so weekdays line up.
        const prev = shift(range, -364);
        return { label: `the same ${length === 7 ? "week" : "days"} last year (${rangeLabel(prev.from, prev.to)})`, ranges: [prev], average: false };
      }
    }
  };

  const salesTotal = (fn: SalesFn, unitOf: (n: number) => Figure, title: string): MetricResult => {
    const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
    const inPeriod = days.map((d) => byDay.get(d)).filter((d): d is SalesDay => Boolean(d));
    const now = fn(inPeriod);
    const cmp = comparison();
    let compare: Extract<MetricResult, { available: true }>["compare"] = null;
    if (cmp && now !== null) {
      const values = cmp.ranges
        .map((r) => fn(countedDays(r, q.weekday).map((d) => byDay.get(d)).filter((d): d is SalesDay => Boolean(d))))
        .filter((v): v is number => v !== null);
      if (values.length) {
        const v = cmp.average ? values.reduce((a, b) => a + b, 0) / values.length : values[0];
        const fig = unitOf(v);
        const p = changePct(now, fig.value);
        compare = { ...fig, label: cmp.label, period: { from: cmp.ranges.at(-1)!.from, to: cmp.ranges[0].to }, change_pct: p, change_display: changeDisplay(p) };
        if (values.length < cmp.ranges.length) base.notes.push(`Only ${values.length} of the ${cmp.ranges.length} comparison periods have sales figures.`);
      }
    }
    if (inPeriod.length < days.length && inPeriod.length) base.notes.push(`${inPeriod.length} of ${days.length} days have sales figures.`);
    if (inPeriod.some((d) => d.net_estimated)) base.notes.push("Some days only had totals including VAT (from a POS file), so net sales were worked out at 20% VAT.");
    return {
      ...base,
      label: label(title),
      value: now === null ? null : unitOf(now),
      compare,
      days_with_data: inPeriod.length,
      source: sourceOf(inPeriod),
      small_sample: salesSample(data, range.to),
      anomalies: anomaliesIn(data, inPeriod.map((d) => d.day)),
    };
  };

  switch (q.metric) {
    case "net_sales":
      return salesTotal(sumNet, money, "Net sales (excluding VAT)");
    case "gross_sales":
      return salesTotal(sumGross, money, "Gross sales (including VAT)");
    case "transactions":
      return salesTotal(sumTransactions, count, "Transactions (number of bills)");
    case "avg_spend":
      return salesTotal(avgSpend, money, "Average spend per transaction (net)");

    case "sales_by_day": {
      const r = salesTotal(sumNet, money, "Net sales by day") as Extract<MetricResult, { available: true }>;
      const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
      r.rows = days
        .filter((d) => byDay.has(d))
        .map((d) => {
          const s = byDay.get(d)!;
          return { label: dayLabel(d, Number(d.slice(0, 4))), ...money(s.net), extra: s.transactions !== null ? { transactions: count(s.transactions) } : undefined };
        });
      const sorted = [...r.rows].sort((a, b) => b.value - a.value);
      if (sorted.length >= 2) r.notes.push(`Best day ${sorted[0].label} (${sorted[0].display}), quietest ${sorted.at(-1)!.label} (${sorted.at(-1)!.display}).`);
      return r;
    }

    case "sales_by_weekday": {
      const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
      const inPeriod = days.map((d) => byDay.get(d)).filter((d): d is SalesDay => Boolean(d));
      const rows: Row[] = [];
      for (const name of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
        const ds = inPeriod.filter((d) => weekdayOf(d.day) === WEEKDAY_INDEX(name));
        if (!ds.length) continue;
        rows.push({ label: `${name} (average of ${ds.length})`, ...money(ds.reduce((s, d) => s + d.net, 0) / ds.length) });
      }
      return { ...base, label: label("Average net sales by day of the week"), value: null, compare: null, rows, days_with_data: inPeriod.length, source: sourceOf(inPeriod), small_sample: salesSample(data, range.to), anomalies: anomaliesIn(data, inPeriod.map((d) => d.day)) };
    }

    case "sales_by_hour": {
      const set = new Set(days);
      const hours = data.sales_hours.filter((h) => set.has(h.day));
      const dayCount = new Set(hours.map((h) => h.day)).size;
      const totals = new Map<number, number>();
      for (const h of hours) totals.set(h.hour, (totals.get(h.hour) ?? 0) + h.sales);
      const rows = [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([hour, total]) => ({ label: `${hour}:00 to ${hour + 1}:00 (average a day)`, ...money(total / dayCount) }));
      if (!dayCount) base.notes.push("No hourly figures for this period (till reports without an hourly breakdown, or no sales data).");
      const top = [...rows].sort((a, b) => b.value - a.value)[0];
      if (top) base.notes.push(`Busiest hour: ${top.label.replace(" (average a day)", "")}.`);
      return { ...base, label: label("Sales by hour (including VAT, average per day)"), value: null, compare: null, rows, days_with_data: dayCount, source: dayCount ? "till reports, POS files or dummy data (hourly)" : "no hourly data", small_sample: salesSample(data, range.to), anomalies: [] };
    }

    case "item_sales": {
      const set = new Set(days);
      const items = new Map<string, { name: string; quantity: number; amount: number }>();
      for (const i of data.sales_items.filter((x) => set.has(x.day))) {
        const key = i.item.trim().toLowerCase();
        const t = items.get(key) ?? { name: i.item.trim(), quantity: 0, amount: 0 };
        t.quantity += i.quantity;
        t.amount += i.amount;
        items.set(key, t);
      }
      const ranked = [...items.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount);
      const prevTotals = new Map<string, number>();
      const cmp = comparison();
      if (cmp) {
        const prev = new Set(cmp.ranges.flatMap((r) => countedDays(r, q.weekday)));
        for (const i of data.sales_items.filter((x) => prev.has(x.day))) prevTotals.set(i.item.trim().toLowerCase(), (prevTotals.get(i.item.trim().toLowerCase()) ?? 0) + i.quantity / cmp.ranges.length);
      }
      const rows: Row[] = ranked.map((t) => ({
        label: t.name,
        ...count(t.quantity),
        extra: { sold_for_incl_vat: money(t.amount), ...(cmp ? { compare_quantity: count(prevTotals.get(t.name.toLowerCase()) ?? 0), compare: cmp.label } : {}) },
      }));
      if (!rows.length) base.notes.push("No item sales for this period (item sales come from POS files).");
      return { ...base, label: label("Items sold (quantity; amounts include VAT)"), value: null, compare: null, rows, days_with_data: new Set(data.sales_items.filter((x) => set.has(x.day)).map((x) => x.day)).size, source: "POS files or dummy data (items)", small_sample: salesSample(data, range.to), anomalies: [] };
    }

    case "weather": {
      const set = new Set(days);
      const w = data.weather.filter((x) => set.has(x.day));
      const rows: Row[] = w.map((x) => ({
        label: dayLabel(x.day, Number(x.day.slice(0, 4))),
        ...mm(x.rain_mm ?? 0),
        extra: { ...(x.temp_max !== null ? { high: celsius(x.temp_max) } : {}), ...(x.conditions ? { conditions: x.conditions } : {}) },
      }));
      return { ...base, label: label("Weather (rain each day, top temperature)"), value: null, compare: null, rows, days_with_data: w.length, source: "Open-Meteo weather for the restaurant's postcode", small_sample: null, anomalies: [] };
    }

    case "rain_vs_dry": {
      const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
      const rain = new Map(data.weather.map((x) => [x.day, x.rain_mm ?? 0]));
      const both = days.filter((d) => byDay.has(d) && rain.has(d));
      const wet = both.filter((d) => (rain.get(d) ?? 0) >= 1);
      const dry = both.filter((d) => (rain.get(d) ?? 0) < 1);
      const avg = (ds: string[]) => ds.reduce((s, d) => s + byDay.get(d)!.net, 0) / ds.length;
      const rows: Row[] = [];
      if (wet.length) rows.push({ label: `Rainy days (1mm or more): ${wet.length}`, ...money(avg(wet)) });
      if (dry.length) rows.push({ label: `Dry days: ${dry.length}`, ...money(avg(dry)) });
      const value = wet.length && dry.length ? pct(((avg(wet) - avg(dry)) / avg(dry)) * 100) : null;
      base.notes.push("Average net sales on rainy days against dry days. Days of the week aren't balanced, so treat it as a pattern, not a cause.");
      return {
        ...base,
        label: label("Rainy days against dry days (average net sales; value = rainy days' difference)"),
        value,
        compare: null,
        rows,
        days_with_data: both.length,
        source: `${sourceOf(both.map((d) => byDay.get(d)!))} and Open-Meteo weather`,
        small_sample: wet.length < 5 || dry.length < 5 ? `Only ${wet.length} rainy and ${dry.length} dry days with sales figures, too few to read much into.` : salesSample(data, range.to),
        anomalies: [],
      };
    }

    case "reviews": {
      const inPeriod = data.reviews.filter((r) => r.date.slice(0, 10) >= range.from && r.date.slice(0, 10) <= range.to);
      const rated = inPeriod.filter((r) => r.rating !== null);
      const upTo = data.reviews.filter((r) => r.rating !== null && r.date.slice(0, 10) <= range.to);
      const rows: Row[] = [
        { label: "New reviews", ...count(inPeriod.length) },
        ...(rated.length ? [{ label: "Average stars of the new reviews", ...stars(rated.reduce((s, r) => s + r.rating!, 0) / rated.length) }] : []),
        { label: "New reviews replied to so far", ...count(inPeriod.filter((r) => r.replied_at).length) },
        ...(upTo.length ? [{ label: `Rating across all ${upTo.length} reviews (at the end of the period)`, ...stars(upTo.reduce((s, r) => s + r.rating!, 0) / upTo.length) }] : []),
      ];
      const cmp = comparison();
      let compare: Extract<MetricResult, { available: true }>["compare"] = null;
      if (cmp) {
        const counts = cmp.ranges.map((r) => data.reviews.filter((x) => x.date.slice(0, 10) >= r.from && x.date.slice(0, 10) <= r.to).length);
        const v = counts.reduce((a, b) => a + b, 0) / counts.length;
        const p = changePct(inPeriod.length, v);
        compare = { ...count(v), label: cmp.label, period: { from: cmp.ranges.at(-1)!.from, to: cmp.ranges[0].to }, change_pct: p, change_display: changeDisplay(p) };
      }
      return { ...base, label: label("Google reviews (value = new reviews)"), value: count(inPeriod.length), compare, rows, days_with_data: null, source: "Google reviews", small_sample: inPeriod.length < 5 ? `Only ${inPeriod.length} new review${inPeriod.length === 1 ? "" : "s"} in this period, so the average moves a lot with each one.` : null, anomalies: [] };
    }

    case "list_growth": {
      const n = (r: Range) => data.signups.filter((t) => t.slice(0, 10) >= r.from && t.slice(0, 10) <= r.to).length;
      const now = n(range);
      const cmp = comparison();
      let compare: Extract<MetricResult, { available: true }>["compare"] = null;
      if (cmp) {
        const v = cmp.ranges.map(n).reduce((a, b) => a + b, 0) / cmp.ranges.length;
        const p = changePct(now, v);
        compare = { ...count(v), label: cmp.label, period: { from: cmp.ranges.at(-1)!.from, to: cmp.ranges[0].to }, change_pct: p, change_display: changeDisplay(p) };
      }
      const total = data.signups.filter((t) => t.slice(0, 10) <= range.to).length;
      return { ...base, label: label("New email sign-ups"), value: count(now), compare, rows: [{ label: "Sign-ups in all, to the end of the period", ...count(total) }], days_with_data: null, source: "the sign-up form", small_sample: null, anomalies: [] };
    }

    case "campaign_results": {
      const wanted = q.campaign?.trim().toLowerCase();
      const list = data.campaigns.filter((c) =>
        wanted ? c.id.toLowerCase() === wanted || nameMatches(c.name, wanted) : c.sent_at && c.sent_at.slice(0, 10) >= range.from && c.sent_at.slice(0, 10) <= range.to,
      );
      if (!list.length) {
        return { ...base, label: "Email campaigns", value: null, compare: null, rows: [], days_with_data: null, source: "campaign emails", small_sample: null, anomalies: [], notes: [wanted ? `No campaign called "${q.campaign}". Campaigns there are: ${data.campaigns.map((c) => `"${c.name}" (sent ${c.sent_at ? c.sent_at.slice(0, 10) : "not yet"})`).join(", ") || "none"}.` : "No campaigns were sent in this period."] };
      }
      const byDay = new Map(data.sales_days.map((d) => [d.day, d]));
      const rows: Row[] = [];
      let redeemed = 0;
      for (const c of list) {
        const sends = data.sends.filter((s) => s.campaign_id === c.id);
        const r = sends.filter((s) => s.redeemed_at).length;
        redeemed += r;
        const extra: Record<string, Figure | string> = {
          sent_at: c.sent_at ? dayLabel(c.sent_at.slice(0, 10), Number(c.sent_at.slice(0, 4))) : "not sent",
          offer: c.offer ?? "",
          emailed: count(sends.filter((s) => s.delivery === "email").length),
          simulated_test_sends: count(sends.filter((s) => s.delivery === "simulated").length),
          opened: count(sends.filter((s) => s.opened_at).length),
          clicked: count(sends.filter((s) => s.clicked_at).length),
          redeemed: count(r),
        };
        // Net sales on the days the offer ran, against the same weekdays in the 4 weeks before.
        if (c.valid_from && c.valid_until) {
          const offerDays = daysIn({ from: c.valid_from, to: c.valid_until > data.today ? addDays(data.today, -1) : c.valid_until }).filter((d) => byDay.has(d));
          if (offerDays.length) {
            const during = offerDays.reduce((s, d) => s + byDay.get(d)!.net, 0);
            const before = [1, 2, 3, 4].map((w) => offerDays.map((d) => byDay.get(addDays(d, -7 * w))?.net).filter((v): v is number => v !== undefined)).filter((xs) => xs.length === offerDays.length);
            extra.offer_days = `${rangeLabel(offerDays[0], offerDays.at(-1)!)} (${offerDays.length} day${offerDays.length === 1 ? "" : "s"} with sales figures)`;
            extra.net_sales_on_offer_days = money(during);
            if (before.length) {
              const usual = before.reduce((s, xs) => s + xs.reduce((a, b) => a + b, 0), 0) / before.length;
              extra.usual_net_sales_same_weekdays_previous_4_weeks = money(usual);
              const p = changePct(during, usual);
              if (p !== null) extra.difference_pct = pct(p);
            }
          }
        }
        rows.push({ label: c.name, ...count(r), extra });
      }
      base.notes.push("Sales on offer days are shown next to the usual for those weekdays. They happened at the same time as the offer; that alone doesn't show the offer caused them (only a unique offer code would).");
      return {
        ...base,
        label: "Email campaigns (value = redemptions)",
        value: count(redeemed),
        compare: null,
        rows,
        days_with_data: null,
        source: "campaign emails and redemptions",
        small_sample: redeemed < 20 ? `Only ${redeemed} redemption${redeemed === 1 ? "" : "s"} (under 20), too few to judge the offer by.` : null,
        anomalies: [],
      };
    }

    case "google_stats": {
      if (!data.google) {
        return unavailable(
          "Google listing views, calls and direction requests",
          "Google isn't connected for real yet (dummy mode), so these figures don't exist. They arrive once the restaurant's Google Business Profile is connected.",
        );
      }
      const set = new Set(days);
      const g = data.google.filter((x) => set.has(x.day));
      const sum = (k: "views" | "calls" | "directions") => g.reduce((s, x) => s + x[k], 0);
      return {
        ...base,
        label: label("Google listing (value = views)"),
        value: count(sum("views")),
        compare: null,
        rows: [
          { label: "Views", ...count(sum("views")) },
          { label: "Calls", ...count(sum("calls")) },
          { label: "Direction requests", ...count(sum("directions")) },
        ],
        days_with_data: g.length,
        source: "Google Business Profile",
        small_sample: null,
        anomalies: [],
      };
    }

    case "sales_target": {
      const r = salesTotal(sumNet, money, "Net sales against the weekly target") as Extract<MetricResult, { available: true }>;
      r.rows = [{ label: "Weekly target", ...money(data.sales_target!) }];
      return r;
    }

    // The week ahead: the forecast's likely sales (before VAT) and its range, day by day.
    case "sales_forecast": {
      const ahead = forecastDays(data, days);
      if ("missing" in ahead) return unavailable(ahead.missing, ahead.how_to_get);
      const total = ahead.days.reduce((s, d) => s + d.sales_mid, 0);
      const low = ahead.days.reduce((s, d) => s + d.sales_low, 0);
      const high = ahead.days.reduce((s, d) => s + d.sales_high, 0);
      const rows: Row[] = ahead.days.map((d) => ({
        label: `${dayLabel(d.date, Number(d.date.slice(0, 4)))} (likely)`,
        ...money(d.sales_mid),
        extra: { low: money(d.sales_low), high: money(d.sales_high), ...(d.orders !== null ? { orders: count(d.orders) } : {}) },
      }));
      rows.push({ label: "Whole period: likely range, low end", ...money(low) }, { label: "Whole period: likely range, high end", ...money(high) });
      if (ahead.skipped) base.notes.push(`${ahead.skipped} day${ahead.skipped === 1 ? " is" : "s are"} already past or have no forecast, so they aren't counted.`);
      base.notes.push(ahead.unvalidated ? "A test forecast (not yet checked against this restaurant's past weeks)." : "A forecast from the restaurant's own sales history: a likely figure with a range, not a promise.");
      return { ...base, label: label("Forecast net sales (excluding VAT)"), value: money(total), compare: null, rows, days_with_data: ahead.days.length, source: ahead.source, small_sample: null, anomalies: [] };
    }

    // Staff cost from the rota (hours x each person's rate), and as a % of sales:
    // actual sales for days gone, the forecast's likely sales for days ahead.
    case "labour_cost": {
      const weeks = data.labour_weeks ?? null;
      if (!weeks) return unavailable("staff costs (the rota)", "Labour cost comes from the weekly rota: add the team (e.g. _add Ali, kitchen, £13, weekdays_) and the rota is costed each week.");
      const byDay = new Map<string, { cost: number; status: string }>();
      for (const w of weeks) for (const [day, cost] of Object.entries(w.by_day)) byDay.set(day, { cost, status: w.status });
      const withRota = days.filter((d) => byDay.has(d));
      if (!withRota.length) return unavailable("a rota for that period", "There's no rota (draft or approved) for those days yet. Next week's draft arrives on Thursday, or text ROTA.");
      const cost = withRota.reduce((s, d) => s + byDay.get(d)!.cost, 0);
      const sales = new Map(data.sales_days.map((d) => [d.day, d.net]));
      const ahead = forecastDays(data, withRota.filter((d) => d >= data.today));
      const forecast = new Map("days" in ahead ? ahead.days.map((d) => [d.date, d.sales_mid]) : []);
      const salesFor = (d: string) => (d < data.today ? (sales.get(d) ?? null) : (forecast.get(d) ?? null));
      const counted = withRota.filter((d) => salesFor(d) !== null);
      const salesTotal = counted.reduce((s, d) => s + salesFor(d)!, 0);
      const costCounted = counted.reduce((s, d) => s + byDay.get(d)!.cost, 0);
      const rows: Row[] = withRota.map((d) => {
        const sd = salesFor(d);
        const c = byDay.get(d)!.cost;
        return { label: dayLabel(d, Number(d.slice(0, 4))), ...money(c), extra: (sd ? { labour_pct_of_sales: pct((c / sd) * 100), sales: money(sd), sales_kind: d < data.today ? "actual" : "forecast" } : { sales_kind: "no sales figure" }) as Record<string, Figure | string> };
      });
      if (salesTotal > 0) rows.push({ label: "Labour as a % of sales, over the days with a sales figure", ...pct((costCounted / salesTotal) * 100) });
      if (data.labour_target_pct) rows.push({ label: "The owner's labour target (% of sales)", ...pct(data.labour_target_pct) });
      const statuses = [...new Set(withRota.map((d) => byDay.get(d)!.status))];
      base.notes.push(`From the ${statuses.includes("draft") && statuses.length === 1 ? "draft" : statuses.includes("draft") ? "approved and draft" : "approved"} rota: hours x each person's hourly rate, before holiday pay, NI or pension.`);
      if (withRota.some((d) => d >= data.today)) base.notes.push("Days ahead are compared with the forecast's likely sales, not real takings.");
      if (weeks.some((w) => w.missing_rates)) base.notes.push("Some shifts have no hourly rate, so they aren't counted.");
      return { ...base, label: label("Staff cost from the rota"), value: money(cost), compare: null, rows, days_with_data: withRota.length, source: "the rota and staff pay rates", small_sample: null, anomalies: [] };
    }
  }
  throw new QueryError(`Unknown metric ${String(q.metric)}`);
}

// Every number a result contains (value, comparison, change, rows, anomalies),
// with its display form: what the agent's figures may quote.
export function numbersIn(result: MetricResult): Figure[] {
  const out: Figure[] = [];
  const add = (f: Figure | null | undefined) => f && out.push({ value: f.value, unit: f.unit, display: f.display });
  const fromText = (text: string) => {
    // ("1mm" counts too: no word boundary is needed after the number; "15% off" is a percentage.)
    for (const m of text.replace(/£[\d,.]+/g, "").matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(\s?%)?/g)) add(m[2] ? pct(Number(m[1])) : count(Number(m[1])));
  };
  // Not available: only the counts and percentages code wrote in why ("off by 31%, over the 20% limit", "8 whole weeks").
  if (!result.available) {
    fromText(`${result.missing} ${result.how_to_get}`);
    return out;
  }
  add(result.value);
  if (result.compare) {
    add(result.compare);
    if (result.compare.change_pct !== null) add(pct(result.compare.change_pct));
  }
  for (const r of result.rows) {
    add(r);
    for (const v of Object.values(r.extra ?? {})) if (typeof v === "object") add(v);
  }
  for (const a of result.anomalies) {
    add(a.value);
    add(a.usual);
    out.push({ value: a.times, unit: "count", display: `${a.times}` });
  }
  if (result.days_with_data !== null) add(count(result.days_with_data));
  // How long the period is ("12 weeks", "28 days").
  const days = daysBetween(result.period.from, result.period.to) + 1;
  add(count(days));
  if (days % 7 === 0) add(count(days / 7));
  // Counts quoted in the small-sample warning and notes ("Only 18 days of sales data")...
  // ...and in the comparison's wording and text details ("the average of the 4 Saturdays before", "4 days with sales figures").
  const words = [result.compare?.label ?? "", ...result.rows.flatMap((r) => [r.label, ...Object.values(r.extra ?? {}).filter((v): v is string => typeof v === "string")])];
  for (const text of [result.small_sample ?? "", ...result.notes, ...words]) fromText(text);
  return out;
}
