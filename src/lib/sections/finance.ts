import "server-only";
import { calendarBlock, linesBetween, schoolCoverage } from "@/lib/calendar-lines";
import { coverageNote } from "@/lib/calendar-lines/rules";
import { londonYmd } from "@/lib/clock";
import { labourForWeek, labourTarget } from "@/lib/finance/labour";
import { financeBlock, forecastLine, labourLine, labourPctOf, lastWeekLines, lastWeekSummary, longDay, type LabourWeek } from "@/lib/finance/rules";
import { getWeekAhead, weekForecastAsOf } from "@/lib/forecast/week-ahead";
import { addDaysYmd, mondayOf, weekDays, weekTotals, type WeekAhead } from "@/lib/forecast/week-ahead-rules";
import type { Period } from "@/lib/report/build";
import { appUrl } from "@/lib/supabase";
import type { BriefSectionDef, ReportSectionDef } from "./types";

// The pilot's finance and calendar blocks (docs/pilot-sprint.md, "Finance
// forecast and calendar"): in the 9am brief, this week's forecast and labour
// (Mondays) and the calendar lines (every day); in the Monday report, Last week
// and Next week.

// The brief's blocks and the report's sections ask for the same weeks: worked out once a minute.
const memo = new Map<string, { at: number; value: Promise<WeekAhead> }>();
export function weekAheadFor(restaurantId: string, weekStart: string, now: Date) {
  const key = `${restaurantId}|${weekStart}|${londonYmd(now)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = getWeekAhead(restaurantId, weekStart, now);
  value.catch(() => memo.delete(key));
  memo.set(key, { at: Date.now(), value });
  return value;
}

const uploadUrl = (restaurantId: string) => `${appUrl()}/sales?r=${restaurantId}`;

// The labour for a run of days that may cross two rota weeks (RUN REPORT's last 7 days).
async function labourForDays(restaurantId: string, dates: string[]): Promise<LabourWeek> {
  const weeks = await Promise.all([...new Set(dates.map(mondayOf))].map((m) => labourForWeek(restaurantId, m)));
  const byDay: Record<string, number> = {};
  for (const w of weeks) for (const d of dates) if (w.byDay[d] !== undefined) byDay[d] = (byDay[d] ?? 0) + w.byDay[d];
  const statuses = weeks.map((w) => w.status).filter((s) => s !== "none");
  return {
    status: !statuses.length ? "none" : statuses.includes("draft") ? "draft" : statuses[0],
    costPence: Object.values(byDay).reduce((n, c) => n + c, 0),
    hours: weeks.reduce((n, w) => n + w.hours, 0),
    byDay,
    missingRates: weeks.reduce((n, w) => n + w.missingRates, 0),
  };
}

// ---------- The brief ----------

// Mondays: this week's sales forecast (or why there isn't one) and the rota's labour %.
export const financeBriefSection: BriefSectionDef = {
  id: "finance",
  order: 10,
  async block({ restaurant, now }) {
    const today = londonYmd(now);
    if (mondayOf(today) !== today) return null;
    const [ahead, labour, target] = await Promise.all([weekAheadFor(restaurant.id, today, now), labourForWeek(restaurant.id, today), labourTarget(restaurant.id)]);
    return financeBlock({ ahead, labour, target, uploadUrl: uploadUrl(restaurant.id) });
  },
};

// Every morning: the next 3 days' events (the whole week on Mondays), and at most one campaign idea.
export const calendarBriefSection: BriefSectionDef = {
  id: "calendar",
  order: 20,
  block: ({ restaurant, now }) => calendarBlock(restaurant, now, (ws) => weekAheadFor(restaurant.id, ws, now)),
};

// ---------- The report ----------

const periodDates = (p: Period) => weekDays(londonYmd(p.start));
const pounds = (pence: number) => Math.round(pence) / 100;

export const lastWeekReportSection: ReportSectionDef = {
  id: "last_week",
  order: 10,
  replaces: ["forecast"],
  async build({ restaurant, period: p }) {
    const dates = periodDates(p);
    const before = weekDays(londonYmd(p.prevStart));
    const [asOf, prev, labour, labourBefore, target] = await Promise.all([
      weekForecastAsOf(restaurant.id, dates[0]),
      weekForecastAsOf(restaurant.id, before[0]),
      labourForDays(restaurant.id, dates),
      labourForDays(restaurant.id, before),
      labourTarget(restaurant.id),
    ]);
    const s = lastWeekSummary(asOf.days, labour, target);
    if (s.actual === null) return null; // no sales figures: the section stays out
    const prevActual = prev.days.reduce((n, d) => n + (d.actual_pence ?? 0), 0);
    const prevLabour = labourBefore.status !== "none" ? labourPctOf(labourBefore.costPence, prevActual) : null;
    return {
      title: "Last week",
      stats: [
        { label: "Net sales", value: { now: pounds(s.actual), before: pounds(prevActual) }, format: "money" },
        ...(s.labourPct !== null ? [{ label: "Labour % of sales", value: { now: s.labourPct, before: prevLabour ?? s.labourPct }, format: "count" as const }] : []),
      ],
      lines: lastWeekLines(s, labour),
      footnote:
        "Forecast: what our method said that Monday, from the sales before it. Labour: the rota's planned hours x pay, not timesheets. Information about your business, not financial advice.",
    };
  },
  facts: (s) => `Last week: ${s.lines.join(" ")}`,
  actions(s) {
    const out = [];
    const over = s.lines.find((l) => /points? over/.test(l));
    if (over) out.push({ title: "Bring labour back to target", why: over, message: "Show me next week's rota" });
    const worst = s.lines.join(" ").match(/worst: (\w+day)/);
    if (worst) out.push({ title: `Fill ${worst[1]}s`, why: `${worst[1]} was last week's quietest day.`, message: `${worst[1]} is quiet. Draft an email offer to fill it.` });
    return out;
  },
};

// The week the report looks ahead to: this Monday for the scheduled report, else the coming Monday.
function nextWeekStart(p: Period) {
  const end = londonYmd(p.end);
  return mondayOf(end) === end ? end : addDaysYmd(mondayOf(end), 7);
}

export const nextWeekReportSection: ReportSectionDef = {
  id: "next_week",
  order: 30,
  async build({ restaurant, period: p }) {
    const ws = nextWeekStart(p);
    const now = new Date();
    const lastStart = londonYmd(p.start);
    const [ahead, labour, lastLabour, target, last, coverage] = await Promise.all([
      weekAheadFor(restaurant.id, ws, now),
      labourForWeek(restaurant.id, ws),
      labourForDays(restaurant.id, weekDays(lastStart)),
      labourTarget(restaurant.id),
      weekForecastAsOf(restaurant.id, lastStart),
      schoolCoverage(restaurant.id, londonYmd(now)),
    ]);
    const events = await linesBetween(restaurant.id, ws < londonYmd(now) ? londonYmd(now) : ws, addDaysYmd(ws, 6), [ahead]);
    const lines: string[] = [];
    const f = forecastLine(ahead, uploadUrl(restaurant.id));
    if (f) lines.push(f.replace(/^📈 /, ""));
    lines.push(labourLine(labour, ahead, target).replace(/\*/g, ""));
    // Key dates before the busiest day: WhatsApp's short version keeps the first lines.
    if (events.length) lines.push(...events.slice(0, 4).map((e) => e.text));
    else lines.push("No dates in the local calendar that should change trade.");
    if (ahead.show_ranges) {
      const days = ahead.days.filter((d) => d.orders !== null).sort((a, b) => b.orders! - a.orders!);
      if (days.length > 1) lines.push(`Busiest: ${longDay(days[0].date)} (about ${days[0].orders} orders) · quietest: ${longDay(days.at(-1)!.date)} (about ${days.at(-1)!.orders})`);
    }
    const note = coverageNote(coverage);
    if (note) lines.push(note.replace(/_/g, ""));

    const totals = ahead.show_ranges ? weekTotals(ahead.days) : null;
    const lastActual = last.days.reduce((n, d) => n + (d.actual_pence ?? 0), 0);
    return {
      title: "Next week",
      stats: [
        ...(totals ? [{ label: "Likely sales", value: { now: pounds(totals.mid), before: pounds(lastActual) }, format: "money" as const }] : []),
        ...(labour.status !== "none" ? [{ label: "Rota cost", value: { now: pounds(labour.costPence), before: pounds(lastLabour.costPence) }, format: "money" as const }] : []),
      ],
      lines,
      footnote: ahead.accuracy?.error_pct != null && ahead.show_ranges ? `Tested on past weeks, the forecast was off by ${ahead.accuracy.error_pct}% on average. Forecasts are information, not financial advice.` : "Forecasts are information, not financial advice.",
    };
  },
  facts: (s) => `Next week: ${s.lines.join(" ")}`,
  actions(s) {
    const out = [];
    const event = s.lines.map((l) => l.match(/^([^:]+): (.+), expect (busier|quieter)/)).find(Boolean);
    if (event) {
      const [line, when, what, effect] = event;
      out.push(
        effect === "busier"
          ? { title: `Get ready for ${what} on ${when}`, why: line, message: `${what} is on ${when}. Draft an email to regulars about it.` }
          : { title: `Fill ${when}`, why: line, message: `${when} looks quiet (${what}). Draft an email offer to fill it.` },
      );
    }
    if (s.lines.some((l) => /No rota for this week yet/.test(l))) out.push({ title: "Plan next week's rota", why: "There's no rota for next week yet.", message: "ROTA" });
    if (s.lines.some((l) => /Upload last year's sales/.test(l))) out.push({ title: "Upload last year's sales", why: "With 8 weeks or more of sales, you get a forecast every week.", message: "How do I upload my sales?" });
    return out;
  },
};
