// The week ahead (docs/pilot-sprint.md): each day's likely orders, sales as a
// range (orders x the average order value), and orders per hour, for the rota,
// the calendar, the brief and the report to build on. getWeekAhead
// (./week-ahead.ts) fills it from the nightly forecast where there is one, else
// from the sales history (./baseline.ts). dummyWeekAhead is for tests only.
// No imports, so it's unit-tested (tests/pilot-contracts.test.ts).

export type HourAhead = { hour: number; orders: number }; // London hour 0 to 23

export type DayAhead = {
  date: string; // London "YYYY-MM-DD"
  weekday: number; // Monday = 1
  orders: number | null; // likely orders, whole
  orders_low: number | null; // the orders range, whole
  orders_high: number | null;
  normal_orders: number | null; // a normal day of this weekday (the last 8 weeks' middle), to see what moves it
  sales_low: number | null; // pence, before VAT: the orders range x the average order value
  sales_mid: number | null;
  sales_high: number | null;
  orders_by_hour: HourAhead[]; // empty past the hourly forecast's 14 days, or with none
};

// ok: numbers to show. not_enough_history: under 8 weeks of sales (ask for last
// year's). held_back: the back-test's error is over the limit, so no ranges are
// shown (the numbers stay, for the rota's staffing only). past: the week is over.
export type WeekAheadStatus = "ok" | "not_enough_history" | "held_back" | "past";

export type Accuracy = {
  method: "history_v1" | "model"; // our back-test of the history method, or the nightly model's own
  error_pct: number | null; // WAPE, %
  range_hit_pct: number | null; // days inside the range, %
  weeks: number | null;
  limit_pct: number; // the restaurant's limit (forecast_error_limit_pct, else the default)
};

export type WeekAhead = {
  restaurantId: string;
  weekStart: string; // a Monday
  source: "forecast" | "history" | "dummy" | "none"; // forecast: the nightly model (for at least one day)
  status: WeekAheadStatus;
  show_ranges: boolean; // true only when status is "ok"
  unvalidated: boolean; // from a run that didn't pass, under the builder's demo override (TEST)
  history_weeks: number;
  aov_pence: number | null; // net sales per order over the last 8 weeks
  accuracy: Accuracy | null;
  days: DayAhead[]; // always 7, Monday first
};

const DAY_MS = 86_400_000;

export function addDaysYmd(ymd: string, n: number) {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string) {
  return ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function isMonday(ymd: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(Date.parse(`${ymd}T12:00:00Z`)) && weekdayOf(ymd) === 1;
}

export function weekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
}

// The Monday of the week a day is in.
export const mondayOf = (ymd: string) => addDaysYmd(ymd, 1 - weekdayOf(ymd));

export const emptyDay = (date: string): DayAhead => ({
  date,
  weekday: weekdayOf(date),
  orders: null,
  orders_low: null,
  orders_high: null,
  normal_orders: null,
  sales_low: null,
  sales_mid: null,
  sales_high: null,
  orders_by_hour: [],
});

type Range = { low: number; likely: number; high: number };

// A day in the contract's shape: the orders range rounded to whole orders, and
// sales = orders x the average order value (pence). Without an average order
// value (no sales figures yet), the forecast's own sales range if it has one.
export function dayFromForecast(
  date: string,
  input: { orders: Range | null; sales?: Range | null; aovPence?: number | null; normal?: number | null; hours: HourAhead[] },
): DayAhead {
  const o = input.orders;
  const aov = input.aovPence ?? null;
  const sales = o && aov ? { low: o.low * aov, likely: o.likely * aov, high: o.high * aov } : (input.sales ?? null);
  return {
    date,
    weekday: weekdayOf(date),
    orders: o ? Math.round(o.likely) : null,
    orders_low: o ? Math.round(o.low) : null,
    orders_high: o ? Math.round(o.high) : null,
    normal_orders: input.normal != null ? Math.round(input.normal) : null,
    sales_low: sales ? Math.round(sales.low) : null,
    sales_mid: sales ? Math.round(sales.likely) : null,
    sales_high: sales ? Math.round(sales.high) : null,
    orders_by_hour: [...input.hours].sort((a, b) => a.hour - b.hour),
  };
}

// The week's sales: likely and the range (pence), over the days with a forecast.
export function weekTotals(days: DayAhead[]) {
  const withSales = days.filter((d) => d.sales_mid !== null);
  if (!withSales.length) return null;
  const sum = (k: "sales_low" | "sales_mid" | "sales_high") => withSales.reduce((n, d) => n + (d[k] ?? 0), 0);
  return { low: sum("sales_low"), mid: sum("sales_mid"), high: sum("sales_high"), orders: withSales.reduce((n, d) => n + (d.orders ?? 0), 0), days: withSales.length };
}

// ---------- Dummy data (tests only) ----------

// The same trading pattern as the Test Kitchen seed (supabase/seed/test-kitchen.sql):
// orders on a normal day, Monday first; open 12:00 to 22:00 (23:00 Fri and Sat).
export const DUMMY_PROFILE = {
  orders: [62, 58, 66, 78, 118, 132, 96],
  netPerOrderPence: 2000,
  spread: 0.15, // the sales range either side of the likely figure
  hourWeights: { 12: 6, 13: 8, 14: 4, 15: 2, 16: 2, 17: 5, 18: 10, 19: 13, 20: 12, 21: 8, 22: 4 } as Record<number, number>,
};

// A small wobble that's the same every time for the same day (no Math.random).
function wobble(date: string) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 0.94 + (h % 1000) / 1000 * 0.12; // 0.94 to 1.06
}

export function dummyWeekAhead(restaurantId: string, weekStart: string): WeekAhead {
  const p = DUMMY_PROFILE;
  const days = weekDays(weekStart).map((date): DayAhead => {
    const weekday = weekdayOf(date);
    const orders = Math.round(p.orders[weekday - 1] * wobble(date));
    const hours = Object.entries(p.hourWeights).filter(([h]) => Number(h) < 22 || weekday === 5 || weekday === 6);
    const total = hours.reduce((sum, [, w]) => sum + w, 0);
    const mid = orders * p.netPerOrderPence;
    return {
      date,
      weekday,
      orders,
      orders_low: Math.round(orders * (1 - p.spread)),
      orders_high: Math.round(orders * (1 + p.spread)),
      normal_orders: p.orders[weekday - 1],
      sales_low: Math.round(mid * (1 - p.spread)),
      sales_mid: mid,
      sales_high: Math.round(mid * (1 + p.spread)),
      orders_by_hour: hours.map(([h, w]) => ({ hour: Number(h), orders: Math.round(((orders * w) / total) * 10) / 10 })),
    };
  });
  return {
    restaurantId,
    weekStart,
    source: "dummy",
    status: "ok",
    show_ranges: true,
    unvalidated: false,
    history_weeks: 52,
    aov_pence: p.netPerOrderPence,
    accuracy: { method: "history_v1", error_pct: 8, range_hit_pct: 80, weeks: 12, limit_pct: 20 },
    days,
  };
}
