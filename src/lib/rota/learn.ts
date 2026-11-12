// Learning from the owner's own rotas (owner's plan, 12 Nov 2026): their last 2 to
// 4 weeks of rotas, read at setup, set against their sales for those same days.
// Plain counting, no black box:
//   - the fewest of each role they always have on (the 10th percentile of the
//     head count across every open half hour, so one odd quiet hour doesn't count)
//   - when they add someone: a straight line through "people on" against
//     "orders that hour", turned into "1 more per N orders an hour"
//     (with sales by the hour; with day totals only, the day's busiest hour is
//     estimated from its total, and the result is marked as an estimate)
//   - how long before opening and after closing each role starts and stays
//   - each person's usual role, days and times, and who opens and locks up
//   - labour as a % of sales for those weeks, once pay rates are known
// What they do, not what's ideal: shown next to the suggestion for their size.
// No imports beyond ./rules and ./types: unit-tested (tests/rota-learn.test.ts).
import { ordersFor, roleKey, roleLabel, SLOT, type ChannelShares, type Driver, type Span } from "./rules";
import type { Weekday } from "./types";
import { ROLE_SHAPE } from "./presets";

export type ImportedShift = {
  name: string;
  role: string; // as written on the rota (or worked out from its section); roleKey'd here
  date: string; // YYYY-MM-DD, the trading day
  start: number; // minutes after midnight of that day (past 1440 = after midnight)
  end: number;
};

export type LearnDay = {
  date: string;
  weekday: Weekday;
  open: Span[]; // opening hours that day (empty = closed)
  orders: number | null; // the day's orders (or null: no sales that day)
  ordersByHour: Record<number, number> | null; // London hour -> orders, when sales by the hour are known
};

export type LearnedRole = {
  role: string;
  min_on_shift: number;
  orders_per_extra_staff: number | null;
  driver: Driver;
  before_open_minutes: number;
  after_close_minutes: number;
  days: number; // open days the role was on the rota
  basis: "hourly" | "daily" | "minimum"; // how the "1 more per N" was worked out ("minimum": not enough to learn it)
  enough: boolean; // enough days to trust the minimum
};

export type LearnedPerson = {
  name: string;
  role: string;
  days: number[]; // weekdays they usually work
  starts: string | null; // usual start, "HH:MM"
  ends: string | null; // usual end ("23:59" for midnight or later)
  shifts: number;
  opens: boolean; // usually on the first shift of the day
  closes: boolean; // usually on the last
};

export type Learned = {
  weeks: number;
  from: string;
  to: string;
  shifts: number;
  roles: LearnedRole[];
  people: LearnedPerson[];
  salesDays: number; // rota days that had sales to compare with
};

// Fewest open days on the rota before the minimum is trusted, and fewest days
// with sales before "1 more per N" is.
export const MIN_DAYS = 5;
export const MIN_SALES_DAYS = 5;
// With day totals only: the busiest hour as a share of the day, per hour open
// (a day open 10 hours does about 18% of its orders in its busiest hour).
export const PEAK_FACTOR = 1.8;

const round15 = (m: number) => Math.round(m / 15) * 15;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const hhmm = (m: number) => {
  if (m >= 1440) return "23:59";
  const w = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, "0")}:${String(w % 60).padStart(2, "0")}`;
};
const weekdayOf = (date: string) => (((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;
const mondayOf = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - (weekdayOf(date) - 1) * 86_400_000).toISOString().slice(0, 10);
const openMinutes = (open: Span[]) => open.reduce((n, s) => n + (s.end - s.start), 0);

// The role the rota counts it as (a head chef is a chef).
const ruleRole = (role: string) => {
  const k = roleKey(role);
  return k === "head_chef" ? "chef" : k;
};

// "1 more per N": the rota adds floor(orders / N) people above the minimum, so each
// N from 3 to 80 is tried and the one that matches what they did best is kept (on
// a tie, the largest: the fewest extra people). null when there's nothing to learn
// it from (too few times above the minimum), or when "never more" fits as well.
export function perExtra(points: { orders: number; extra: number }[], minAbove = 4) {
  const usable = points.filter((p) => p.orders >= 0);
  if (usable.filter((p) => p.extra > 0).length < minAbove) return null;
  const err = (n: number | null) => usable.reduce((sum, p) => sum + ((n ? Math.floor(p.orders / n) : 0) - Math.max(0, p.extra)) ** 2, 0);
  const none = err(null);
  let best: number | null = null;
  let bestErr = none;
  for (let n = 3; n <= 80; n++) {
    const e = err(n);
    if (e < bestErr || (best !== null && e === bestErr)) {
      best = n;
      bestErr = e;
    }
  }
  return best;
}

// "OPEN SHIFT", "Open shift (chef)", "TBC", "Unassigned": a shift nobody had yet.
export const isOpenShift = (name: string) => /^(open( shift)?|tbc|tba|unassigned|cover needed|vacant)\b/i.test(name.trim());

export function learnFromRotas(input: { shifts: ImportedShift[]; days: LearnDay[]; shares: ChannelShares }): Learned | null {
  const shifts = input.shifts.filter((s) => s.end > s.start && s.name.trim());
  if (!shifts.length) return null;
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const dates = [...new Set(shifts.map((s) => s.date))].sort();
  const openDates = dates.filter((d) => (byDate.get(d)?.open.length ?? 0) > 0);
  const roles = [...new Set(shifts.map((s) => ruleRole(s.role)))];

  const learnedRoles: LearnedRole[] = roles.map((role) => {
    const mine = shifts.filter((s) => ruleRole(s.role) === role);
    const onDays = openDates.filter((d) => mine.some((s) => s.date === d));
    const shape = ROLE_SHAPE[role] ?? {
      driver: "all" as Driver,
      before: 0,
      after: 0,
    };
    const driver = shape.driver;
    // Head count in every open half hour of every open day on the rota (zero where nobody was on).
    const slots: { date: string; minute: number; count: number }[] = [];
    for (const date of openDates) {
      const day = byDate.get(date)!;
      for (const span of day.open) {
        for (let m = span.start; m < span.end; m += SLOT) {
          const count = mine.filter((s) => s.date === date && s.start <= m && s.end >= Math.min(m + SLOT, span.end)).length;
          slots.push({ date, minute: m, count });
        }
      }
    }
    const min = Math.floor(
      percentile(
        slots.map((s) => s.count),
        0.1,
      ),
    );
    // Before opening and after closing: on each day, how early the first started and how late the last stayed.
    const befores: number[] = [];
    const afters: number[] = [];
    for (const date of onDays) {
      const day = byDate.get(date)!;
      const ss = mine.filter((s) => s.date === date);
      befores.push(Math.max(0, day.open[0].start - Math.min(...ss.map((s) => s.start))));
      afters.push(Math.max(0, Math.max(...ss.map((s) => s.end)) - day.open[day.open.length - 1].end));
    }
    const clampEdge = (m: number) => Math.min(120, round15(m));

    let per: number | null = null;
    let basis: LearnedRole["basis"] = "minimum";
    if (driver !== "none") {
      const hourlyDays = openDates.filter((d) => byDate.get(d)?.ordersByHour && Object.values(byDate.get(d)!.ordersByHour!).some((x) => x > 0));
      const dailyDays = openDates.filter((d) => (byDate.get(d)?.orders ?? 0) > 0);
      if (hourlyDays.length >= MIN_SALES_DAYS) {
        const points = slots
          .filter((s) => hourlyDays.includes(s.date))
          .map((s) => ({
            orders: ordersFor({ driver }, byDate.get(s.date)!.ordersByHour![Math.floor(s.minute / 60) % 24] ?? 0, input.shares),
            extra: s.count - min,
          }));
        per = perExtra(points);
        basis = per === null ? "minimum" : "hourly";
      } else if (dailyDays.length >= MIN_SALES_DAYS) {
        const points = dailyDays.map((date) => {
          const day = byDate.get(date)!;
          const hours = Math.max(1, openMinutes(day.open) / 60);
          const peakOrders = ordersFor({ driver }, (day.orders ?? 0) * Math.min(0.5, PEAK_FACTOR / hours), input.shares);
          const peak = Math.max(0, ...slots.filter((s) => s.date === date).map((s) => s.count));
          return { orders: peakOrders, extra: peak - min };
        });
        // Each day gives one point, so fewer of them above the minimum will do.
        per = perExtra(points, 3);
        if (per !== null) basis = "daily";
      }
    }
    return {
      role,
      min_on_shift: min,
      orders_per_extra_staff: per,
      driver,
      before_open_minutes: befores.length ? clampEdge(median(befores)) : shape.before,
      after_close_minutes: afters.length ? clampEdge(median(afters)) : shape.after,
      days: onDays.length,
      basis,
      enough: onDays.length >= MIN_DAYS,
    };
  });

  // People: usual role, days, times; who opens and locks up.
  // An "OPEN SHIFT" row on a rota is a shift that was needed, not a person.
  const names = [...new Set(shifts.map((s) => s.name.trim()))].filter((n) => !isOpenShift(n));
  const weeks = new Set(dates.map(mondayOf)).size;
  const people: LearnedPerson[] = names.map((name) => {
    const mine = shifts.filter((s) => s.name.trim() === name);
    const roleCount = new Map<string, number>();
    for (const s of mine) roleCount.set(roleKey(s.role), (roleCount.get(roleKey(s.role)) ?? 0) + 1);
    const role = [...roleCount].sort((a, b) => b[1] - a[1])[0][0];
    const weekdayWeeks = new Map<number, Set<string>>();
    for (const s of mine) {
      const wd = weekdayOf(s.date);
      if (!weekdayWeeks.has(wd)) weekdayWeeks.set(wd, new Set());
      weekdayWeeks.get(wd)!.add(mondayOf(s.date));
    }
    const need = Math.max(1, Math.ceil(weeks / 2));
    const days = [...weekdayWeeks]
      .filter(([, w]) => w.size >= need)
      .map(([d]) => d)
      .sort((a, b) => a - b);
    let opens = 0;
    let closes = 0;
    for (const s of mine) {
      const sameDay = shifts.filter((x) => x.date === s.date);
      if (s.start <= Math.min(...sameDay.map((x) => x.start))) opens++;
      if (s.end >= Math.max(...sameDay.map((x) => x.end))) closes++;
    }
    return {
      name,
      role,
      days,
      starts: hhmm(round15(median(mine.map((s) => s.start)))),
      ends: hhmm(round15(median(mine.map((s) => s.end)))),
      shifts: mine.length,
      opens: opens / mine.length >= 0.5,
      closes: closes / mine.length >= 0.5,
    };
  });

  return {
    weeks,
    from: dates[0],
    to: dates[dates.length - 1],
    shifts: shifts.length,
    roles: learnedRoles.sort((a, b) => a.role.localeCompare(b.role)),
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    salesDays: openDates.filter((d) => (byDate.get(d)?.orders ?? 0) > 0).length,
  };
}

// Labour as a % of net sales over the rota's days: hours x each person's rate
// (matched by name) / those days' sales. null unless most hours have a rate and
// enough days have sales.
export function labourFromRotas(input: { shifts: ImportedShift[]; ratePenceByName: Record<string, number | null>; salesPenceByDate: Record<string, number | null> }) {
  const withSales = input.shifts.filter((s) => (input.salesPenceByDate[s.date] ?? 0) > 0);
  const days = [...new Set(withSales.map((s) => s.date))];
  if (days.length < MIN_SALES_DAYS) return null;
  const key = (n: string) => n.trim().toLowerCase();
  const rates = new Map(Object.entries(input.ratePenceByName).map(([n, r]) => [key(n), r]));
  let hours = 0;
  let costed = 0;
  let cost = 0;
  for (const s of withSales) {
    const h = (s.end - s.start) / 60;
    hours += h;
    const first = key(s.name).split(/\s+/)[0];
    const rate = rates.get(key(s.name)) ?? [...rates].find(([n]) => n.split(/\s+/)[0] === first)?.[1] ?? null;
    if (rate) {
      costed += h;
      cost += h * rate;
    }
  }
  if (!hours || costed / hours < 0.7) return null;
  const sales = days.reduce((n, d) => n + (input.salesPenceByDate[d] ?? 0), 0);
  // Hours without a rate are costed at the average of those with one.
  const total = cost * (hours / costed);
  return { pct: Math.round((total / sales) * 1000) / 10, days: days.length };
}

// "Kitchen porter: you usually have 1, plus 1 more per 18 orders an hour (from your last 3 weeks)".
export function learnedLine(r: LearnedRole, weeks: number) {
  const name = roleLabel(r.role);
  const base = r.orders_per_extra_staff
    ? `${r.min_on_shift}, plus 1 more per ${r.orders_per_extra_staff} ${r.driver === "all" ? "orders" : `${r.driver.replace("_", "-")} orders`} an hour`
    : `${r.min_on_shift} whenever open`;
  return `${name}: you usually have ${base} (from your last ${weeks} week${weeks === 1 ? "" : "s"}${r.basis === "daily" ? ", estimated from daily sales" : ""})`;
}
