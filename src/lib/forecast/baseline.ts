// The app's own week-ahead forecast from the restaurant's sales history
// (docs/pilot-sprint.md, "Finance forecast"): for each day, the orders on the
// same weekday over the last 8 weeks (the middle one is the likely figure, the
// 10th to 90th percentile the range), times any effect learnt from past events
// of that kind, then sales = orders x the average order value. Without order
// counts (a daily takings file), the same from the weekday's net takings, with
// the recent trend and the time of year (baselineSales); dayRange picks. A
// back-test runs the method over past weeks, using only what was known before
// each week, and its error decides whether the ranges are shown at all.
// No imports, so every rule is unit-tested (tests/finance-forecast.test.ts).

export const BASELINE = {
  minHistoryWeeks: 8, // fewer whole weeks of sales than this: no forecast, ask for last year's sales
  weeks: 8, // a day's forecast looks at the same weekday over the last 8 weeks
  minSameDays: 4, // fewer usable same weekdays than this: no forecast for that day
  low: 0.1, // the range: the 10th to the 90th percentile of those days,
  high: 0.9,
  minSpread: 0.1, // but never narrower than 10% either side of the likely figure (8 days can look steadier than trade is)
  aovWeeks: 8, // the average order value: net sales / orders over the last 8 weeks
  backtestWeeks: 12, // the back-test: up to the last 12 whole weeks
  defaultErrorLimitPct: 20, // ranges show only when the back-test's error is at or under this (per restaurant: forecast_error_limit_pct)
  effectMinTimes: 2, // an event kind needs 2 past days before its effect counts
  effectMinPct: 8, // and a typical change of at least 8% either way
  movesPct: 10, // a day "moves" when its forecast is 10% or more off a normal day of its weekday
} as const;

export type HistoryDay = { day: string; orders: number | null; net_pence: number | null };
export type OrdersRange = { low: number; likely: number; high: number };

const DAY_MS = 86_400_000;
const at = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
export const addDaysTo = (ymd: string, n: number) => new Date(at(ymd) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (ymd: string) => ((new Date(at(ymd)).getUTCDay() + 6) % 7) + 1;

// Whole weeks from the first day with sales to today.
export function historyWeeks(firstDay: string | null, today: string) {
  if (!firstDay || firstDay >= today) return 0;
  return Math.floor((at(today) - at(firstDay)) / (7 * DAY_MS));
}

export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// The same weekday's orders over the last 8 weeks before asOf (days with sales only).
function sameDays(target: string, asOf: string, history: HistoryDay[]) {
  const wd = weekdayOf(target);
  const from = addDaysTo(asOf, -7 * BASELINE.weeks);
  return history
    .filter((h) => h.day < asOf && h.day >= from && weekdayOf(h.day) === wd && (h.orders ?? 0) > 0)
    .map((h) => h.orders as number)
    .sort((a, b) => a - b);
}

// A normal day of the target's weekday, knowing only the days before asOf (null: too few).
export function normalOrders(target: string, asOf: string, history: HistoryDay[]) {
  const xs = sameDays(target, asOf, history);
  return xs.length < BASELINE.minSameDays ? null : quantile(xs, 0.5);
}

// The target day's orders range, knowing only the days before asOf, times an event effect.
export function baselineOrders(target: string, asOf: string, history: HistoryDay[], multiplier = 1): OrdersRange | null {
  const xs = sameDays(target, asOf, history);
  if (xs.length < BASELINE.minSameDays) return null;
  const likely = quantile(xs, 0.5);
  const low = Math.min(quantile(xs, BASELINE.low), likely * (1 - BASELINE.minSpread));
  const high = Math.max(quantile(xs, BASELINE.high), likely * (1 + BASELINE.minSpread));
  return { low: low * multiplier, likely: likely * multiplier, high: high * multiplier };
}

// Net sales per order over the 8 weeks before asOf, in pence (null: no days with both).
export function averageOrderValue(history: HistoryDay[], asOf: string) {
  const from = addDaysTo(asOf, -7 * BASELINE.aovWeeks);
  let net = 0;
  let orders = 0;
  for (const h of history) {
    if (h.day >= asOf || h.day < from || !h.orders || !h.net_pence) continue;
    net += h.net_pence;
    orders += h.orders;
  }
  return orders ? Math.round(net / orders) : null;
}

// ---------- From takings alone (no order counts) ----------
// For restaurants whose sales come without the number of orders (a daily takings
// file): the same weekday's net takings over the last 8 weeks (the middle one and
// the 10th to 90th percentile, as for orders), times the recent trend, times the
// time of year when there's a year of history, times any event effect.

export type SalesRange = { low: number; likely: number; high: number }; // pence, net

export const TAKINGS = {
  trendDays: 28, // the recent trend: the last 4 weeks against the 4 before
  trendWeight: 0.5, // only half the change counts (one odd month shouldn't swing the week)
  trendCap: 0.1, // and never more than 10% either way
  seasonWindow: 3, // time of year: last year's days within 3 days of the target...
  seasonBase: 56, // ...against last year's 8 weeks before the same point
  seasonCap: 0.25, // never more than 25% either way
  seasonMinShare: 0.8, // both of last year's windows need 80% of their days with sales
} as const;

const salesOn = (history: HistoryDay[]) => new Map(history.filter((h) => (h.net_pence ?? 0) > 0).map((h) => [h.day, h.net_pence as number]));

function sameDaySales(target: string, asOf: string, history: HistoryDay[]) {
  const wd = weekdayOf(target);
  const from = addDaysTo(asOf, -7 * BASELINE.weeks);
  return history
    .filter((h) => h.day < asOf && h.day >= from && weekdayOf(h.day) === wd && (h.net_pence ?? 0) > 0)
    .map((h) => h.net_pence as number)
    .sort((a, b) => a - b);
}

// Net takings over the days from `from`, and how many of them had any.
function windowSales(sales: Map<string, number>, from: string, days: number) {
  let total = 0;
  let n = 0;
  for (let i = 0; i < days; i++) {
    const v = sales.get(addDaysTo(from, i));
    if (v) {
      total += v;
      n++;
    }
  }
  return { total, n, days };
}

const clampTo = (x: number, cap: number) => Math.min(1 + cap, Math.max(1 - cap, x));

// The last 4 weeks against the 4 weeks before (both before asOf), dampened and capped. 1 = flat.
export function recentTrend(asOf: string, history: HistoryDay[]) {
  const sales = salesOn(history);
  const recent = windowSales(sales, addDaysTo(asOf, -TAKINGS.trendDays), TAKINGS.trendDays);
  const before = windowSales(sales, addDaysTo(asOf, -2 * TAKINGS.trendDays), TAKINGS.trendDays);
  if (recent.n < TAKINGS.trendDays * 0.75 || before.n < TAKINGS.trendDays * 0.75) return 1;
  const r = recent.total / recent.n / (before.total / before.n);
  return clampTo(1 + (r - 1) * TAKINGS.trendWeight, TAKINGS.trendCap);
}

// Time of year, from last year: the days around the same date (a year ago, same
// weekday: 364 days) against last year's 8 weeks before the same point. 1 = none
// (under a year of history, or gaps in last year's figures).
export function timeOfYear(target: string, asOf: string, history: HistoryDay[]) {
  const sales = salesOn(history);
  const around = windowSales(sales, addDaysTo(target, -364 - TAKINGS.seasonWindow), 2 * TAKINGS.seasonWindow + 1);
  const base = windowSales(sales, addDaysTo(asOf, -364 - TAKINGS.seasonBase), TAKINGS.seasonBase);
  if (around.n < around.days * TAKINGS.seasonMinShare || base.n < base.days * TAKINGS.seasonMinShare) return 1;
  return clampTo(around.total / around.n / (base.total / base.n), TAKINGS.seasonCap);
}

// A normal day's takings of the target's weekday, knowing only the days before asOf (null: too few).
export function normalSales(target: string, asOf: string, history: HistoryDay[]) {
  const xs = sameDaySales(target, asOf, history);
  return xs.length < BASELINE.minSameDays ? null : quantile(xs, 0.5);
}

// The target day's net takings range (pence), knowing only the days before asOf.
export function baselineSales(target: string, asOf: string, history: HistoryDay[], multiplier = 1): SalesRange | null {
  const xs = sameDaySales(target, asOf, history);
  if (xs.length < BASELINE.minSameDays) return null;
  const f = recentTrend(asOf, history) * timeOfYear(target, asOf, history) * multiplier;
  const likely = quantile(xs, 0.5);
  const low = Math.min(quantile(xs, BASELINE.low), likely * (1 - BASELINE.minSpread));
  const high = Math.max(quantile(xs, BASELINE.high), likely * (1 + BASELINE.minSpread));
  return { low: low * f, likely: likely * f, high: high * f };
}

// The day's sales range either way: orders x the average order value where the
// order counts are there (sharper, and what the back-test has always used), else
// takings alone. method says which.
export function dayRange(target: string, asOf: string, history: HistoryDay[], aov: number | null, multipliers: { orders?: number; sales?: number } = {}) {
  const orders = aov ? baselineOrders(target, asOf, history, multipliers.orders ?? 1) : null;
  if (orders && aov) return { method: "orders" as const, orders, sales: { low: orders.low * aov, likely: orders.likely * aov, high: orders.high * aov } };
  const sales = baselineSales(target, asOf, history, multipliers.sales ?? 1);
  return sales ? { method: "takings" as const, orders: null, sales } : null;
}

// ---------- Event effects learnt from the history ----------

export type PastEvent = { date: string; kind: string }; // kind: "sport", "bank_holiday"... (see effectKind)

// Which events share an effect: the kind of date (a match is a match, wherever it is).
export function effectKind(type: string, title: string) {
  if (type === "religious") {
    if (/ramadan/i.test(title)) return "religious:ramadan";
    if (/eid/i.test(title)) return "religious:eid";
    return `religious:${title.toLowerCase().replace(/\s*\(.*\)\s*/g, "").trim()}`;
  }
  return type;
}

// Each kind's typical change on its past days, against a normal day as known then.
// Only kinds seen at least twice, with a typical change of 8% or more, count.
// by: measured on orders (the default), or on takings when there are no order counts.
export function learnEffects(history: HistoryDay[], past: PastEvent[], by: "orders" | "sales" = "orders") {
  const actual = new Map(history.map((h) => [h.day, by === "orders" ? h.orders : h.net_pence]));
  const normalOf = by === "orders" ? normalOrders : normalSales;
  const ratios = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const e of past) {
    const key = `${e.kind}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = actual.get(e.date);
    const normal = normalOf(e.date, e.date, history);
    if (!a || !normal) continue;
    ratios.set(e.kind, [...(ratios.get(e.kind) ?? []), a / normal]);
  }
  const out = new Map<string, { multiplier: number; times: number }>();
  for (const [kind, xs] of ratios) {
    if (xs.length < BASELINE.effectMinTimes) continue;
    const m = quantile([...xs].sort((a, b) => a - b), 0.5);
    if (Math.abs(m - 1) * 100 >= BASELINE.effectMinPct) out.set(kind, { multiplier: Math.round(m * 1000) / 1000, times: xs.length });
  }
  return out;
}

// ---------- The back-test ----------

export type Backtest = {
  method: "history_v1";
  weeks: number; // whole weeks tested
  days: number; // days with a forecast and actual sales
  error_pct: number | null; // sales error: total |forecast - actual| / total actual (WAPE), %
  range_hit_pct: number | null; // days whose actual sales fell inside the range, %
  by_week: { week_start: string; error_pct: number }[];
};

// The method run over the last 12 whole weeks before today, each week using only
// the sales before its Monday (orders range x that week's average order value,
// or takings alone on days without order counts: dayRange).
export function backtest(history: HistoryDay[], today: string): Backtest {
  const lastMonday = addDaysTo(today, -(weekdayOf(today) - 1) - 7); // the last whole week's Monday
  let err = 0;
  let total = 0;
  let hits = 0;
  let days = 0;
  const byWeek: Backtest["by_week"] = [];
  const actual = new Map(history.map((h) => [h.day, h.net_pence]));
  for (let w = 0; w < BASELINE.backtestWeeks; w++) {
    const monday = addDaysTo(lastMonday, -7 * w);
    const aov = averageOrderValue(history, monday);
    let wErr = 0;
    let wTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDaysTo(monday, i);
      const a = actual.get(d);
      const f = dayRange(d, monday, history, aov)?.sales;
      if (!a || !f) continue;
      wErr += Math.abs(f.likely - a);
      wTotal += a;
      if (a >= f.low && a <= f.high) hits++;
      days++;
    }
    if (!wTotal) continue;
    err += wErr;
    total += wTotal;
    byWeek.push({ week_start: monday, error_pct: round1((wErr / wTotal) * 100) });
  }
  return {
    method: "history_v1",
    weeks: byWeek.length,
    days,
    error_pct: total ? round1((err / total) * 100) : null,
    range_hit_pct: days ? round1((hits / days) * 100) : null,
    by_week: byWeek.reverse(),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// May the week's ranges be shown? Only with an error measured and at or under the limit.
export function rangesAllowed(errorPct: number | null | undefined, limitPct: number | null | undefined) {
  const limit = limitPct ?? BASELINE.defaultErrorLimitPct;
  return errorPct !== null && errorPct !== undefined && Number.isFinite(errorPct) && errorPct <= limit;
}

// Each hour's share of a weekday's orders, from the hourly sales history (empty: none).
export function hourShares(hours: { day: string; hour: number; orders: number | null }[], weekday: number) {
  const byHour = new Map<number, number>();
  let total = 0;
  for (const h of hours) {
    if (weekdayOf(h.day) !== weekday || !h.orders) continue;
    byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + h.orders);
    total += h.orders;
  }
  if (!total) return [];
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, n]) => ({ hour, share: n / total }));
}
