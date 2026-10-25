import "server-only";
import { londonYmd } from "@/lib/clock";
import { dummyDataAllowed } from "@/lib/dummy-data";
import { forecastHoursFromRun } from "@/lib/ops/models";
import { loadForecast } from "@/lib/forecast";
import { dayFromForecast, dummyWeekAhead, emptyDay, isMonday, weekDays, type HourAhead, type WeekAhead } from "./week-ahead-rules";

// The week ahead (docs/pilot-sprint.md), built on the nightly forecast: the same
// run the 9am brief uses (loadForecast: the 07:00 refresh for days 0 to 2, the
// 05:35 run for the rest, only runs that passed unless the demo override is on).
// Days before today have no forecast (null). In test mode, a demo restaurant
// with no forecast at all gets dummy data, marked source "dummy".
export async function getWeekAhead(restaurantId: string, weekStart: string, now = new Date()): Promise<WeekAhead> {
  if (!isMonday(weekStart)) throw new Error(`getWeekAhead: ${weekStart} isn't a Monday`);
  const dates = weekDays(weekStart);
  const today = londonYmd(now);
  const none: WeekAhead = { restaurantId, weekStart, source: "none", unvalidated: false, days: dates.map(emptyDay) };
  const loaded = dates[6] < today ? null : await loadForecast(restaurantId, today, dates[6]);
  if (!loaded || loaded.kind === "none") return (await dummyDataAllowed(restaurantId)) ? dummyWeekAhead(restaurantId, weekStart) : none;

  // Hourly orders: from the run itself, or (for a refresh) the 05:35 run it was based on.
  const from = dates[0] < today ? today : dates[0];
  const baseId = (loaded.run.metrics as { base_run_id?: string } | null)?.base_run_id;
  const [own, base] = await Promise.all([
    forecastHoursFromRun(restaurantId, loaded.run.id, from, dates[6]),
    baseId ? forecastHoursFromRun(restaurantId, baseId, from, dates[6]) : Promise.resolve([]),
  ]);
  const hours = new Map<string, HourAhead[]>();
  for (const rows of [own, base]) {
    const byDay = new Map<string, HourAhead[]>();
    for (const r of rows) {
      if (r.local_hour === null) continue;
      const list = byDay.get(r.target_day) ?? [];
      list.push({ hour: r.local_hour, orders: Math.round(Number(r.likely) * 10) / 10 });
      byDay.set(r.target_day, list);
    }
    for (const [d, list] of byDay) if (!hours.has(d)) hours.set(d, list);
  }

  return {
    restaurantId,
    weekStart,
    source: "forecast",
    unvalidated: loaded.unvalidated,
    days: dates.map((d) => {
      const v = loaded.days.get(d);
      return v ? dayFromForecast(d, { orders: v.orders, sales: v.sales, hours: hours.get(d) ?? [] }) : emptyDay(d);
    }),
  };
}
