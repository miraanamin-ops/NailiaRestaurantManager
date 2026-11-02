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

const NOT_A_REASON = new Set(["local_event", "football", "event", "sport"]);

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
  // days: the days with a rota (the % is against those days' takings only).
  labour: { cost: number; pct: number; target: number | null; days: number } | null;
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
  // Only dates that move a whole day's trade count as a reason: the events feed lists
  // every show and attraction in London (hundreds a month), and football fixtures
  // aren't local. At most two, without repeats ("Half term" once, not per borough).
  const calendarOn = (day: string) =>
    [...new Set(input.calendar.filter((c) => c.day === day && !NOT_A_REASON.has(c.type)).map((c) => c.name.replace(/\s*\(.*\)$/, "")))].slice(0, 2);
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

  // Labour: the rota's staff cost on the month's days, against the takings of those
  // same days (a month with one week of rotas isn't compared with four weeks' takings).
  let labour: MonthlyFigures["labour"] = null;
  const byDayCost = (data.labour_weeks ?? []).flatMap((w) => Object.entries(w.by_day)).filter(([d]) => d.startsWith(month));
  const rotaTakings = byDayCost.reduce((s, [d]) => s + (byDay.get(d)?.net ?? 0), 0);
  if (byDayCost.length && rotaTakings > 0) {
    const cost = round(byDayCost.reduce((s, [, c]) => s + c, 0));
    labour = { cost, pct: round((cost / rotaTakings) * 100, 1), target: data.labour_target_pct ?? null, days: byDayCost.length };
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
    f.labour ? `Labour: ${money(f.labour.cost)}, ${f.labour.pct}% of takings${f.labour.days < f.traded ? ` on the ${f.labour.days} days with a rota` : ""}${f.labour.target ? ` (target ${f.labour.target}%)` : ""}.` : "",
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
  return { headline, actions, highlights: fallbackHighlights(f) };
}

// Code's own key messages (3 or 4, each with a different number).
export function fallbackHighlights(f: MonthlyFigures): Highlight[] {
  const out: Highlight[] = [];
  const c = f.vsLastMonth?.likeForLike;
  out.push({
    title: c != null ? `${c >= 0 ? "Up" : "Down"} ${Math.abs(c)}% on ${f.vsLastMonth!.label.split(" ")[0]}` : `${gbp(f.net)} in ${f.label.split(" ")[0]}`,
    detail: f.vsLastMonth ? `${f.vsLastMonth.label.split(" ")[0]} took ${gbp(f.vsLastMonth.net)}, allowing for the mix of weekdays.` : `Over ${f.traded} trading days.`,
  });
  const days = f.weekdays.filter((w) => w.avg !== null).sort((a, b) => b.avg! - a.avg!);
  if (days.length >= 2) {
    const [best, worst] = [days[0], days.at(-1)!];
    out.push({ title: `${FULL_DAY[best.weekday]} is your big day`, detail: `${gbp(best.avg!)} on average, against ${gbp(worst.avg!)} on a ${FULL_DAY[worst.weekday]}.` });
  }
  if (f.dishes) out.push({ title: `${f.dishes.top[0].item} leads the menu`, detail: `${gbp(f.dishes.top[0].amount)} this month; your top 3 dishes are ${f.dishes.topShare}% of dish sales.` });
  const m = f.movers.find((x) => !x.reason.startsWith("No obvious"));
  if (m) out.push({ title: `${m.label}: ${m.diff >= 0 ? "+" : "-"}${gbp(Math.abs(m.diff))} on a usual day`, detail: `${m.reason}.` });
  else if (f.closures.length) out.push({ title: `${f.closures.length} day${f.closures.length === 1 ? "" : "s"} with no sales`, detail: `Worth about ${gbp(f.closures.reduce((s, x) => s + x.usual, 0))} on usual days.` });
  return out.slice(0, 4);
}
const FULL_DAY: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

// What's saved in reports.data for a monthly report (frozen when made).
// highlights: the 3 or 4 key messages (reports made before they existed have a summary instead).
export type Highlight = { title: string; detail: string };
export type MonthlyWords = { headline: string; summary?: string; highlights?: Highlight[]; actions: { title: string; why: string; message: string }[] };
export type MonthlyReportData = {
  kind: "monthly";
  // 2: with highlights. MONTHLY REPORT remakes a version 1 report rather than resend it.
  version: 1 | 2;
  restaurant: { name: string; brandColor: string; brandDark: string };
  figures: MonthlyFigures;
  words: MonthlyWords;
  // The WhatsApp number the action buttons open a chat with (digits only), if known.
  whatsappNumber: string | null;
  simulated: string | null;
};
export const isMonthly = (data: unknown): data is MonthlyReportData => (data as { kind?: string } | null)?.kind === "monthly";

// The WhatsApp message with the report (the PDF goes just before it).
export const monthlyWhatsApp = (d: MonthlyReportData, url: string) => `📊 *${d.figures.label} at ${d.restaurant.name}*\n${d.words.headline}\n🔗 ${url}`;

// The end-of-month prompts in the brief (batched, never on their own):
//   last day of the month: "tomorrow I'll write your report: send the month's export tonight"
//   1st and 3rd, while the month isn't covered: a reminder
//   covered (the last day has figures), or the 4th: the report is made with what there is
export type MonthStep = { kind: "ask"; month: string } | { kind: "remind"; month: string } | { kind: "make"; month: string } | { kind: "none" };
export function monthStep(input: { today: string; reportExists: boolean; lastDayCovered: boolean; hasSales: boolean }): MonthStep {
  if (!input.hasSales) return { kind: "none" };
  const dom = Number(input.today.slice(8));
  const thisMonth = input.today.slice(0, 7);
  if (daysOf(thisMonth).at(-1) === input.today) return { kind: "ask", month: thisMonth };
  if (dom > 4) return { kind: "none" };
  const month = previousMonth(input.today);
  if (input.reportExists) return { kind: "none" };
  if (input.lastDayCovered || dom === 4) return { kind: "make", month };
  return dom === 1 || dom === 3 ? { kind: "remind", month } : { kind: "none" };
}

export function monthPrompt(step: Extract<MonthStep, { kind: "ask" | "remind" }>, uploadUrl: string) {
  const name = monthName(step.month).split(" ")[0];
  const how = "From Square: Reports, then Item sales, set the dates to the whole month, then Export (a daily sales summary works too).";
  return step.kind === "ask"
    ? `📊 Tomorrow I'll write your ${name} report. After you close tonight, send me ${name}'s sales export here, dish by dish if your till has it. ${how} Or upload it: ${uploadUrl}`
    : `📊 Your ${name} report is waiting for ${name}'s last sales. Send me the export here (${how.charAt(0).toLowerCase()}${how.slice(1)}) or upload it: ${uploadUrl}. If it isn't in by the 4th, I'll write it with what I have.`;
}

// Shared by the page and the PDF.
export const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
export const MONTHLY_FOOTNOTE = "Like for like: compared at the same mix of weekdays, so five Saturdays don't count as growth. Information about your business, not financial advice.";

// MONTHLY REPORT [SEPTEMBER]: which month. No name: last month; a name: the latest
// finished month of that name (in November, OCTOBER is this year's, DECEMBER last year's).
export function monthFor(today: string, monthNumber: number | null) {
  const last = previousMonth(today);
  if (!monthNumber) return last;
  const [y, m] = last.split("-").map(Number);
  return `${monthNumber <= m ? y : y - 1}-${String(monthNumber).padStart(2, "0")}`;
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
export const labourLine = (l: NonNullable<MonthlyFigures["labour"]>, traded: number) =>
  `staff cost of takings (${gbp(l.cost)}${l.days < traded ? ` over the ${l.days} days with a rota` : ""}${l.target ? `, target ${l.target}%` : ""})`;

// The key messages to show (reports made before highlights existed get code's own).
export const highlightsOf = (d: MonthlyReportData) => (d.words.highlights?.length ? d.words.highlights : fallbackHighlights(d.figures));

// One small line at the bottom for everything left out: "Not included yet: ...".
export const notIncluded = (f: MonthlyFigures) =>
  f.missing.length ? `Not included yet: ${f.missing.map((m) => m.split(":")[0].replace(/^./, (c) => c.toLowerCase())).join("; ")}. Send the exports to add them next month.` : null;
