import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { calendarFor } from "@/lib/local-calendar";
import { forecastHoursFromRun } from "@/lib/ops/models";
import { loadForecast } from "@/lib/forecast";
import { selectAll } from "@/lib/sales/store";
import { getSupabase } from "@/lib/supabase";
import { getUpcomingEvents } from "@/lib/upcoming-events";
import type { UpcomingEvent } from "@/lib/upcoming-events-rules";
import {
  addDaysTo,
  averageOrderValue,
  backtest,
  BASELINE,
  baselineOrders,
  effectKind,
  historyWeeks,
  hourShares,
  learnEffects,
  normalOrders,
  rangesAllowed,
  type Backtest,
  type HistoryDay,
} from "./baseline";
import { dayFromForecast, emptyDay, isMonday, weekdayOf, weekDays, type Accuracy, type HourAhead, type WeekAhead } from "./week-ahead-rules";

// The week ahead (docs/pilot-sprint.md, "Finance forecast"). Real data only:
//   - under 8 whole weeks of sales: no numbers (status not_enough_history), never made up;
//   - each day's orders from the nightly forecast where it has that day (loadForecast:
//     the same runs the 9am brief uses), else from the sales history (./baseline.ts),
//     with any effect learnt from past events of the same kind on that day;
//   - sales = the orders range x the average order value of the last 8 weeks;
//   - the ranges only show when the measured error (our back-test, saved once a day
//     in forecast_backtests, or the nightly model's own) is at or under the
//     restaurant's limit (forecast_error_limit_pct, default 20%); otherwise held_back.
// Days before today are empty.

type RestaurantRow = { forecast_error_limit_pct: number | string | null };

async function salesHistory(restaurantId: string, from: string, to: string): Promise<HistoryDay[]> {
  const rows = await selectAll<{ day: string; transactions: number | null; net_sales: number | string | null }>((a, b) =>
    getSupabase().from("sales_days").select("day, transactions, net_sales").eq("restaurant_id", restaurantId).gte("day", from).lte("day", to).order("day").range(a, b),
  );
  return rows.map((r) => ({ day: r.day, orders: r.transactions, net_pence: r.net_sales === null ? null : Math.round(Number(r.net_sales) * 100) }));
}

async function firstSalesDay(restaurantId: string) {
  const row = check(await getSupabase().from("sales_days").select("day").eq("restaurant_id", restaurantId).order("day").limit(1).maybeSingle<{ day: string }>());
  return row?.day ?? null;
}

async function hourHistory(restaurantId: string, from: string, to: string) {
  const rows = await selectAll<{ day: string; hour: number; transactions: number | null }>((a, b) =>
    getSupabase().from("sales_hours").select("day, hour, transactions").eq("restaurant_id", restaurantId).gte("day", from).lte("day", to).range(a, b),
  );
  return rows.map((r) => ({ day: r.day, hour: Number(r.hour), orders: r.transactions }));
}

// Today's back-test of the history method: saved once a day, so the brief, the
// report and the rota all quote the same error.
export async function ensureBacktest(restaurantId: string, today: string, history: HistoryDay[]): Promise<Backtest> {
  const saved = check(
    await getSupabase()
      .from("forecast_backtests")
      .select("method, weeks, days, error_pct, range_hit_pct, details")
      .eq("restaurant_id", restaurantId)
      .eq("method", "history_v1")
      .eq("tested_on", today)
      .maybeSingle<{ weeks: number; days: number; error_pct: number | string | null; range_hit_pct: number | string | null; details: { by_week?: Backtest["by_week"] } | null }>(),
  );
  if (saved) {
    const num = (v: number | string | null) => (v === null ? null : Number(v));
    return { method: "history_v1", weeks: saved.weeks, days: saved.days, error_pct: num(saved.error_pct), range_hit_pct: num(saved.range_hit_pct), by_week: saved.details?.by_week ?? [] };
  }
  const result = backtest(history, today);
  check(
    await getSupabase()
      .from("forecast_backtests")
      .upsert(
        { restaurant_id: restaurantId, method: result.method, tested_on: today, weeks: result.weeks, days: result.days, error_pct: result.error_pct, range_hit_pct: result.range_hit_pct, details: { by_week: result.by_week } },
        { onConflict: "restaurant_id,method,tested_on" },
      ),
  );
  return result;
}

// The effect multiplier for a day, from its events: learnt kinds only. Dummy
// events (test mode, a demo restaurant with nothing in its calendar) carry a
// stated effect so the demo shows the wording; they're labelled dummy.
const DUMMY_EFFECT = { busier: 1.15, quieter: 0.85, neutral: 1 } as const;
function multiplierFor(events: UpcomingEvent[], effects: Map<string, { multiplier: number }>) {
  let m = 1;
  for (const e of events) {
    if (e.source === "dummy") m *= DUMMY_EFFECT[e.expected_effect];
    else m *= effects.get(effectKind(e.type, e.title))?.multiplier ?? 1;
  }
  return Math.min(2, Math.max(0.3, m));
}

// The nightly model's own back-test error (WAPE on orders), if its run has one.
function errorFromModel(metrics: unknown) {
  const p = (metrics as { primary?: { wape?: number | null; coverage?: number | null } } | null)?.primary;
  if (p?.wape == null) return null;
  return { error_pct: Math.round(p.wape * 1000) / 10, range_hit_pct: p.coverage != null ? Math.round(p.coverage * 1000) / 10 : null };
}

export async function getWeekAhead(restaurantId: string, weekStart: string, now = new Date()): Promise<WeekAhead> {
  if (!isMonday(weekStart)) throw new Error(`getWeekAhead: ${weekStart} isn't a Monday`);
  const dates = weekDays(weekStart);
  const today = londonYmd(now);
  const [restaurant, first] = await Promise.all([
    getSupabase().from("restaurants").select("forecast_error_limit_pct").eq("id", restaurantId).maybeSingle<RestaurantRow>(),
    firstSalesDay(restaurantId),
  ]);
  const limitRaw = check(restaurant)?.forecast_error_limit_pct;
  const limit = limitRaw != null && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : BASELINE.defaultErrorLimitPct;
  const weeks = historyWeeks(first, today);
  const base = { restaurantId, weekStart, unvalidated: false, history_weeks: weeks, show_ranges: false, days: dates.map(emptyDay) };
  if (weeks < BASELINE.minHistoryWeeks) return { ...base, source: "none", status: "not_enough_history", aov_pence: null, accuracy: null };
  if (dates[6] < today) return { ...base, source: "none", status: "past", aov_pence: null, accuracy: null };

  const yesterday = addDaysTo(today, -1);
  const from = dates[0] < today ? today : dates[0];
  const [history, loaded, upcoming, past, hours] = await Promise.all([
    salesHistory(restaurantId, addDaysTo(today, -400), yesterday),
    loadForecast(restaurantId, today, dates[6]),
    getUpcomingEvents(restaurantId, from, dates[6]),
    calendarFor(restaurantId, addDaysTo(today, -365), yesterday),
    hourHistory(restaurantId, addDaysTo(today, -7 * BASELINE.weeks), yesterday),
  ]);
  const aov = averageOrderValue(history, today);
  const effects = learnEffects(history, past.map((c) => ({ date: c.day, kind: effectKind(c.type, c.name) })));
  const test = await ensureBacktest(restaurantId, today, history);

  // Hourly orders from the model: the run itself, or (for a refresh) the 05:35 run it was based on.
  const modelHours = new Map<string, HourAhead[]>();
  if (loaded.kind === "forecast") {
    const baseId = (loaded.run.metrics as { base_run_id?: string } | null)?.base_run_id;
    const [own, baseRows] = await Promise.all([
      forecastHoursFromRun(restaurantId, loaded.run.id, from, dates[6]),
      baseId ? forecastHoursFromRun(restaurantId, baseId, from, dates[6]) : Promise.resolve([]),
    ]);
    for (const rows of [own, baseRows]) {
      const byDay = new Map<string, HourAhead[]>();
      for (const r of rows) {
        if (r.local_hour === null) continue;
        const list = byDay.get(r.target_day) ?? [];
        list.push({ hour: r.local_hour, orders: Math.round(Number(r.likely) * 10) / 10 });
        byDay.set(r.target_day, list);
      }
      for (const [d, list] of byDay) if (!modelHours.has(d)) modelHours.set(d, list);
    }
  }

  let fromModel = 0;
  const days = dates.map((d) => {
    if (d < today) return emptyDay(d);
    const normal = normalOrders(d, today, history);
    const model = loaded.kind === "forecast" ? loaded.days.get(d) : undefined;
    if (model?.orders) {
      fromModel++;
      return dayFromForecast(d, { orders: model.orders, sales: model.sales, aovPence: aov, normal, hours: modelHours.get(d) ?? [] });
    }
    const orders = baselineOrders(d, today, history, multiplierFor(upcoming.filter((e) => e.date === d), effects));
    if (!orders) return emptyDay(d);
    return dayFromForecast(d, {
      orders,
      aovPence: aov,
      normal,
      hours: hourShares(hours, weekdayOf(d)).map((s) => ({ hour: s.hour, orders: Math.round(orders.likely * s.share * 10) / 10 })),
    });
  });

  // The error that decides the ranges: the model's own when it made any of the days, else our back-test.
  const modelError = fromModel && loaded.kind === "forecast" ? errorFromModel(loaded.metrics) : null;
  const accuracy: Accuracy = modelError
    ? { method: "model", ...modelError, weeks: null, limit_pct: limit }
    : { method: "history_v1", error_pct: test.error_pct, range_hit_pct: test.range_hit_pct, weeks: test.weeks, limit_pct: limit };
  const show = rangesAllowed(accuracy.error_pct, limit) && days.some((d) => d.sales_mid !== null);
  return {
    ...base,
    source: fromModel ? "forecast" : "history",
    status: show ? "ok" : "held_back",
    show_ranges: show,
    unvalidated: fromModel > 0 && loaded.kind === "forecast" && loaded.unvalidated,
    aov_pence: aov,
    accuracy,
    days,
  };
}

// What the history method would have said for a past week on its Monday morning,
// knowing only the sales before it, next to what happened (the report's "sales vs forecast").
export async function weekForecastAsOf(restaurantId: string, weekStart: string) {
  const dates = weekDays(weekStart);
  const history = await salesHistory(restaurantId, addDaysTo(weekStart, -7 * BASELINE.weeks), dates[6]);
  const aov = averageOrderValue(history, weekStart);
  const actual = new Map(history.map((h) => [h.day, h]));
  return {
    aov,
    days: dates.map((d) => {
      const o = baselineOrders(d, weekStart, history);
      return {
        date: d,
        sales_low: o && aov ? Math.round(o.low * aov) : null,
        sales_mid: o && aov ? Math.round(o.likely * aov) : null,
        sales_high: o && aov ? Math.round(o.high * aov) : null,
        actual_pence: actual.get(d)?.net_pence ?? null,
        actual_orders: actual.get(d)?.orders ?? null,
      };
    }),
  };
}
