// The monthly report's numbers (docs/monthly-report.md): plain code with no
// imports beyond types, so every rule is unit-tested (tests/monthly-report.test.ts).
// Claude only writes the words, from these numbers (lib/report/monthly.ts).
//
// Fair comparisons: a month is compared with last month and the same month last
// year LIKE FOR LIKE, i.e. against what this month's own mix of weekdays would have
// taken at the other month's weekday averages (five Saturdays don't count as growth).
// Each section is left out (with what would unlock it) when its data isn't there.

import type { MetricsData } from "@/lib/agents/insights-metrics";

export type CalendarDay = { day: string; name: string; type: string };

const DAY_MS = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1
const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const pct = (now: number, before: number) => (before > 0 ? round(((now - before) / before) * 100, 1) : null);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "2026-10" for the month before the one `today` is in.
export function previousMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export function daysOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// Most of the month has figures: it can be compared.
const COVERED = 0.8;

export type Mover = { day: string; label: string; net: number; usual: number; diff: number; reason: string };
export type MonthlyFigures = {
  month: string;
  label: string;
  days: number;
  traded: number;
  net: number;
  orders: number | null;
  avgOrder: number | null;
  daily: { day: string; net: number | null }[];
  vsLastMonth: { label: string; net: number; raw: number | null; likeForLike: number | null } | null;
  vsLastYear: { label: string; net: number; raw: number | null; likeForLike: number | null } | null;
  movers: Mover[];
  closures: { day: string; label: string; usual: number }[];
  weekdays: { weekday: string; avg: number | null }[];
  hours: { busiest: string; quietest: string; grid: { weekday: string; hours: { hour: number; avg: number }[] }[] } | null;
  dishes: {
    top: { item: string; amount: number; quantity: number }[];
    bottom: { item: string; amount: number; quantity: number }[];
    rising: { item: string; change: number }[];
    falling: { item: string; change: number }[];
    slow: { item: string; perWeek: number }[];
    topShare: number;
  } | null;
  labour: { cost: number; pct: number; target: number | null } | null;
  reviews: { count: number; average: number | null } | null;
  // What's missing, and what it would unlock (one line each).
  missing: string[];
};

const dayLabel = (ymd: string) => `${WEEKDAYS[weekdayOf(ymd) - 1]} ${Number(ymd.slice(8))}`;

export function monthlyFigures(input: { data: MetricsData; month: string; calendar: CalendarDay[] }): MonthlyFigures | null {
  const { data, month } = input;
  const days = daysOf(month);
  const byDay = new Map(data.sales_days.filter((d) => d.net > 0).map((d) => [d.day, d]));
  const inMonth = days.filter((d) => byDay.has(d));
  if (!inMonth.length) return null;
  const net = round(inMonth.reduce((s, d) => s + byDay.get(d)!.net, 0), 2);
  const withOrders = inMonth.filter((d) => byDay.get(d)!.transactions);
  const orders = withOrders.length ? withOrders.reduce((s, d) => s + (byDay.get(d)!.transactions ?? 0), 0) : null;
  const avgOrder = orders ? round(withOrders.reduce((s, d) => s + byDay.get(d)!.net, 0) / orders, 2) : null;
  const missing: string[] = [];

  // Like for like: this month's own weekdays at the other month's weekday averages.
  const compare = (other: string, label: string) => {
    const od = daysOf(other).filter((d) => byDay.has(d));
    if (od.length < daysOf(other).length * COVERED || inMonth.length < days.length * COVERED) return null;
    const avg = new Map<number, number>();
    for (let w = 1; w <= 7; w++) {
      const xs = od.filter((d) => weekdayOf(d) === w).map((d) => byDay.get(d)!.net);
      if (xs.length) avg.set(w, xs.reduce((a, b) => a + b, 0) / xs.length);
    }
    const otherNet = round(od.reduce((s, d) => s + byDay.get(d)!.net, 0), 2);
    const expected = inMonth.reduce((s, d) => s + (avg.get(weekdayOf(d)) ?? 0), 0);
    return { label, net: otherNet, raw: pct(net, otherNet), likeForLike: expected ? pct(net, expected) : null };
  };
  const lastMonth = shiftMonth(month, -1);
  const lastYear = shiftMonth(month, -12);
  const vsLastMonth = compare(lastMonth, monthName(lastMonth));
  const vsLastYear = compare(lastYear, monthName(lastYear));
  if (!vsLastYear) missing.push(`Compared with ${monthName(lastYear)}: needs that month's sales.`);

  // The usual for a day: the median of the same weekday over the 8 weeks before it.
  const usualFor = (day: string) => median(Array.from({ length: 8 }, (_, i) => byDay.get(addDays(day, -7 * (i + 1)))?.net).filter((x): x is number => typeof x === "number"));
  const calendarOn = (day: string) => input.calendar.filter((c) => c.day === day).map((c) => c.name);
  const weatherOn = new Map(data.weather.map((w) => [w.day, w]));
  const reasonFor = (day: string, up: boolean) => {
    const named = calendarOn(day);
    if (named.length) return named.join(", ");
    const w = weatherOn.get(day);
    if (!up && w?.rain_mm != null && w.rain_mm >= 5) return `Heavy rain (${round(w.rain_mm)}mm)`;
    if (up && w?.temp_max != null && w.temp_max >= 24) return `A warm day (${round(w.temp_max)}°C)`;
    return "No obvious reason in the calendar or the weather";
  };
  const movers = inMonth
    .map((day) => {
      const usual = usualFor(day);
      const n = byDay.get(day)!.net;
      return usual ? { day, label: dayLabel(day), net: round(n), usual: round(usual), diff: round(n - usual) } : null;
    })
    .filter((m): m is Omit<Mover, "reason"> => m !== null && Math.abs(m.diff) >= m.usual * 0.15)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5)
    .map((m) => ({ ...m, reason: reasonFor(m.day, m.diff > 0) }));

  // A weekday they usually trade with no figures: closed (or not sent in).
  const tradesOn = new Set(inMonth.map(weekdayOf));
  const closures = days
    .filter((d) => !byDay.has(d) && tradesOn.has(weekdayOf(d)) && d <= addDays(data.today, -1))
    .map((d) => ({ day: d, label: dayLabel(d), usual: round(usualFor(d) ?? 0) }));

  const weekdays = WEEKDAYS.map((name, i) => {
    const xs = inMonth.filter((d) => weekdayOf(d) === i + 1).map((d) => byDay.get(d)!.net);
    return { weekday: name, avg: xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null };
  });

  // Hours: the average for each weekday and hour, where the figures have hours.
  const hourRows = data.sales_hours.filter((h) => h.day.startsWith(month));
  let hours: MonthlyFigures["hours"] = null;
  if (hourRows.length) {
    const cells = new Map<string, number[]>();
    for (const h of hourRows) {
      const k = `${weekdayOf(h.day)}:${h.hour}`;
      cells.set(k, [...(cells.get(k) ?? []), h.sales]);
    }
    const grid = WEEKDAYS.map((name, i) => ({
      weekday: name,
      hours: [...cells.entries()]
        .filter(([k]) => Number(k.split(":")[0]) === i + 1)
        .map(([k, xs]) => ({ hour: Number(k.split(":")[1]), avg: round(xs.reduce((a, b) => a + b, 0) / xs.length) }))
        .sort((a, b) => a.hour - b.hour),
    }));
    const flat = grid.flatMap((g) => g.hours.map((h) => ({ ...h, weekday: g.weekday })));
    const hr = (h: number) => (h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`);
    const slot = (x: { weekday: string; hour: number }) => `${x.weekday} ${hr(x.hour)} to ${hr(x.hour + 1)}`;
    const busiest = flat.reduce((a, b) => (b.avg > a.avg ? b : a));
    const quietest = flat.filter((x) => x.avg > 0).reduce((a, b) => (b.avg < a.avg ? b : a));
    hours = { busiest: slot(busiest), quietest: slot(quietest), grid };
  } else missing.push("Busiest and quietest hours: needs sales with times (e.g. Square's Transactions export).");

  // Dishes, where the figures are dish by dish.
  const itemRows = (m: string) => data.sales_items.filter((i) => i.day.startsWith(m));
  const thisItems = itemRows(month);
  let dishes: MonthlyFigures["dishes"] = null;
  if (thisItems.length) {
    const sum = (rows: typeof thisItems) => {
      const out = new Map<string, { amount: number; quantity: number; days: Set<string> }>();
      for (const r of rows) {
        const x = out.get(r.item) ?? { amount: 0, quantity: 0, days: new Set<string>() };
        x.amount += r.amount;
        x.quantity += r.quantity;
        x.days.add(r.day);
        out.set(r.item, x);
      }
      return out;
    };
    const now = sum(thisItems);
    const before = sum(itemRows(lastMonth));
    const nowDays = new Set(thisItems.map((r) => r.day)).size;
    const beforeDays = new Set(itemRows(lastMonth).map((r) => r.day)).size;
    const ranked = [...now.entries()].map(([item, x]) => ({ item, amount: round(x.amount, 2), quantity: round(x.quantity) })).sort((a, b) => b.amount - a.amount);
    const total = ranked.reduce((s, x) => s + x.amount, 0);
    // Change per trading day, so a month with more days of figures isn't "rising"; only dishes selling 20+.
    const changes = beforeDays
      ? ranked
          .map((x) => {
            const b = before.get(x.item);
            if (!b || (x.quantity < 20 && b.quantity < 20)) return null;
            return { item: x.item, change: pct(x.quantity / nowDays, b.quantity / beforeDays) };
          })
          .filter((c): c is { item: string; change: number } => c !== null && c.change !== null)
      : [];
    dishes = {
      top: ranked.slice(0, 5),
      bottom: ranked.length > 5 ? ranked.slice(-3).reverse() : [],
      rising: changes.filter((c) => c.change >= 10).sort((a, b) => b.change - a.change).slice(0, 3),
      falling: changes.filter((c) => c.change <= -10).sort((a, b) => a.change - b.change).slice(0, 3),
      slow: ranked.map((x) => ({ item: x.item, perWeek: round((x.quantity / nowDays) * 7, 1) })).filter((x) => x.perWeek < 5),
      topShare: total ? round((ranked.slice(0, 3).reduce((s, x) => s + x.amount, 0) / total) * 100) : 0,
    };
    if (!beforeDays) missing.push(`Dishes rising and falling: needs ${monthName(lastMonth)}'s dish-by-dish sales too.`);
  } else missing.push("Your dishes: needs a dish-by-dish export (e.g. Square's Item sales).");

  // Labour: the rota's staff cost on the month's days, against the month's takings.
  let labour: MonthlyFigures["labour"] = null;
  const byDayCost = (data.labour_weeks ?? []).flatMap((w) => Object.entries(w.by_day)).filter(([d]) => d.startsWith(month));
  if (byDayCost.length) {
    const cost = round(byDayCost.reduce((s, [, c]) => s + c, 0));
    labour = { cost, pct: round((cost / net) * 100, 1), target: data.labour_target_pct ?? null };
  } else missing.push("Labour as a share of takings: needs the month's rotas.");

  const monthReviews = data.reviews.filter((r) => r.date.startsWith(month));
  const rated = monthReviews.filter((r) => r.rating !== null);
  const reviews = monthReviews.length ? { count: monthReviews.length, average: rated.length ? round(rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length, 1) : null } : null;

  return {
    month,
    label: monthName(month),
    days: days.length,
    traded: inMonth.length,
    net,
    orders,
    avgOrder,
    daily: days.map((d) => ({ day: d, net: byDay.get(d)?.net ?? null })),
    vsLastMonth,
    vsLastYear,
    movers,
    closures,
    weekdays,
    hours,
    dishes,
    labour,
    reviews,
    missing,
  };
}

// The facts Claude writes the words from (never the raw rows).
export function monthlyFacts(f: MonthlyFigures, restaurant: string) {
  const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const lines = [
    `${restaurant}, ${f.label}: ${money(f.net)} net over ${f.traded} trading days${f.orders ? `, ${f.orders} orders, ${money(f.avgOrder ?? 0)} average order` : ""}.`,
    f.vsLastMonth ? `vs ${f.vsLastMonth.label}: ${f.vsLastMonth.raw}% raw, ${f.vsLastMonth.likeForLike}% like for like (same weekday mix).` : "No comparable previous month.",
    f.vsLastYear ? `vs ${f.vsLastYear.label}: ${f.vsLastYear.likeForLike}% like for like.` : "",
    ...f.movers.map((m) => `${m.label}: ${money(m.net)} vs a usual ${money(m.usual)} (${m.diff > 0 ? "+" : ""}${money(m.diff)}). ${m.reason}.`),
    ...f.closures.map((c) => `${c.label}: no sales (closed?), usually ${money(c.usual)}.`),
    `Weekday averages: ${f.weekdays.map((w) => `${w.weekday} ${w.avg === null ? "none" : money(w.avg)}`).join(", ")}.`,
    f.hours ? `Busiest: ${f.hours.busiest}. Quietest: ${f.hours.quietest}.` : "",
    f.dishes ? `Top dishes: ${f.dishes.top.map((d) => `${d.item} ${money(d.amount)}`).join(", ")}. Top 3 are ${f.dishes.topShare}% of dish sales.` : "",
    f.dishes?.rising.length ? `Rising: ${f.dishes.rising.map((d) => `${d.item} +${d.change}%`).join(", ")}.` : "",
    f.dishes?.falling.length ? `Falling: ${f.dishes.falling.map((d) => `${d.item} ${d.change}%`).join(", ")}.` : "",
    f.dishes?.slow.length ? `Selling under 5 a week: ${f.dishes.slow.map((d) => d.item).join(", ")}.` : "",
    f.labour ? `Labour: ${money(f.labour.cost)}, ${f.labour.pct}% of takings${f.labour.target ? ` (target ${f.labour.target}%)` : ""}.` : "",
    f.reviews ? `Reviews: ${f.reviews.count}${f.reviews.average ? `, average ${f.reviews.average} stars` : ""}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// Code's own words, when Claude can't be reached (never blank).
export function fallbackWords(f: MonthlyFigures) {
  const change = f.vsLastMonth?.likeForLike;
  const headline = `£${Math.round(f.net).toLocaleString("en-GB")} net in ${f.label.split(" ")[0]}${change != null ? `, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${f.vsLastMonth!.label.split(" ")[0]} like for like` : ""}.`;
  const quiet = f.weekdays.filter((w) => w.avg !== null).sort((a, b) => a.avg! - b.avg!)[0];
  const actions = [
    quiet ? `Give ${quiet.weekday}s a reason to come in: a set lunch or a deal for regulars.` : "Pick your quietest day and give it a reason to come in.",
    f.dishes?.slow.length ? `Look again at ${f.dishes.slow[0].item}: it sells under 5 a week.` : "Check your best sellers are easy to find on the menu and on Google.",
    "Reply to every review this month, good and bad.",
  ];
  return { headline, actions };
}
