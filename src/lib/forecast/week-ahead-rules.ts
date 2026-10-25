// The week ahead (docs/pilot-sprint.md): each day's likely orders, sales as a
// range, and orders per hour, for the rota, the calendar and the brief to build
// on. getWeekAhead (./week-ahead.ts) fills it from the nightly forecast; in test
// mode a demo restaurant with no forecast gets dummyWeekAhead instead.
// No imports, so it's unit-tested (tests/pilot-contracts.test.ts).

export type HourAhead = { hour: number; orders: number }; // London hour 0 to 23

export type DayAhead = {
  date: string; // London "YYYY-MM-DD"
  weekday: number; // Monday = 1
  orders: number | null; // likely orders, whole
  sales_low: number | null; // pence, before VAT
  sales_mid: number | null;
  sales_high: number | null;
  orders_by_hour: HourAhead[]; // empty past the hourly forecast's 14 days, or with none
};

export type WeekAhead = {
  restaurantId: string;
  weekStart: string; // a Monday
  source: "forecast" | "dummy" | "none";
  unvalidated: boolean; // from a run that didn't pass, under the builder's demo override (TEST)
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

export const emptyDay = (date: string): DayAhead => ({
  date,
  weekday: weekdayOf(date),
  orders: null,
  sales_low: null,
  sales_mid: null,
  sales_high: null,
  orders_by_hour: [],
});

type Range = { low: number; likely: number; high: number };

// The forecast's ranges, in the contract's shape (rounded to whole orders and pence).
export function dayFromForecast(date: string, input: { orders: Range | null; sales: Range | null; hours: HourAhead[] }): DayAhead {
  return {
    date,
    weekday: weekdayOf(date),
    orders: input.orders ? Math.round(input.orders.likely) : null,
    sales_low: input.sales ? Math.round(input.sales.low) : null,
    sales_mid: input.sales ? Math.round(input.sales.likely) : null,
    sales_high: input.sales ? Math.round(input.sales.high) : null,
    orders_by_hour: [...input.hours].sort((a, b) => a.hour - b.hour),
  };
}

// ---------- Dummy data (test mode only) ----------

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
      sales_low: Math.round(mid * (1 - p.spread)),
      sales_mid: mid,
      sales_high: Math.round(mid * (1 + p.spread)),
      orders_by_hour: hours.map(([h, w]) => ({ hour: Number(h), orders: Math.round(((orders * w) / total) * 10) / 10 })),
    };
  });
  return { restaurantId, weekStart, source: "dummy", unvalidated: false, days };
}
