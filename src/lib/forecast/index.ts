import "server-only";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { unvalidatedForecastsAllowed } from "./access";
import { recipientsFor } from "@/lib/campaigns";
import { londonTime, londonWeekday, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { forecastFromRun, forecastOverride, forecastRun, forecastRunsSince, type ForecastDriverRow } from "@/lib/ops/models";
import { restaurantEventsBetween } from "@/lib/ops/outside";
import type { ForecastRow } from "@/lib/ops/types";
import { addDays } from "@/lib/sales/format";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import {
  channelsToShow,
  composeForecastBlock,
  coversRecorded,
  daysAheadFlags,
  FORECAST_CONFIG,
  forecastStatus,
  lookUpLines,
  noForecastReason,
  normalDay,
  offerBlockedLine,
  offerDay,
  offerQuestion,
  REFRESH_MODEL,
  reasonsFor,
  roundCount,
  roundSales,
  showFootnote,
  usableRuns,
  yesterdayLine,
  type Flag,
  type LookUpDay,
  type Range,
  type RunInfo,
  type Reason,
} from "./rules";

// The forecast in the owner's messages: the 9am brief's block (the same for the
// GM's brief and today's), the assistant's look_up_forecast, the Monday report's
// "How the forecast did" and the builder's view on /log. Every model output comes
// through lib/ops/models.ts; every number and word comes from ./rules.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

export type OfferRecord = {
  day: string;
  status: "offered" | "blocked" | "drafted" | "declined";
  question?: string;
  likely: number;
  normal: number;
  pct: number;
  reason: string | null;
  draft_id?: string | null;
  decided_at?: string | null;
};

export type ForecastBriefRow = {
  updated_at: string;
  id: string;
  restaurant_id: string;
  day: string;
  status: "shown" | "no_forecast" | "none";
  reason: string | null;
  run_id: string | null;
  run_name: string | null;
  unvalidated: boolean;
  orders_low: number | null;
  orders_likely: number | null;
  orders_high: number | null;
  sales_likely: number | null;
  block: string | null;
  flags: Flag[];
  offer: OfferRecord | null;
  created_at: string;
};

// ---------- Loading today's forecast ----------

type DayData = { orders: Range | null; sales: Range | null; covers: Range | null; channels: Map<string, Range>; drivers: { factor: string; multiplier: number }[] };

export type Loaded =
  | { kind: "forecast"; run: RunInfo; unvalidated: boolean; metrics: unknown; days: Map<string, DayData> }
  | { kind: "none"; hadRecently: boolean; reason: string };

const range = (r: ForecastRow): Range => ({ low: Number(r.low), likely: Number(r.likely), high: Number(r.high) });

function byDay(forecasts: ForecastRow[], drivers: ForecastDriverRow[]) {
  const days = new Map<string, DayData>();
  const get = (d: string) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = { orders: null, sales: null, covers: null, channels: new Map(), drivers: [] }));
    return v;
  };
  for (const f of forecasts) {
    const d = get(f.target_day);
    if (f.channel === "all") {
      if (f.metric === "orders") d.orders = range(f);
      if (f.metric === "sales_pence") d.sales = range(f);
      if (f.metric === "covers") d.covers = range(f);
    } else if (f.metric === "orders") d.channels.set(f.channel, range(f));
  }
  for (const r of drivers) if (r.channel === "all") get(r.target_day).drivers.push({ factor: r.factor, multiplier: Number(r.multiplier) });
  return days;
}

// The forecast for today and the days after (to toDay) from today's best run: the
// 07:00 refresh for days 0 to 2 where it may be used, the 05:35 run for the rest.
export async function loadForecast(restaurantId: string, today: string, toDay: string): Promise<Loaded> {
  const since = new Date(new Date(`${today}T12:00:00Z`).getTime() - FORECAST_CONFIG.recentDays * DAY_MS).toISOString();
  const [runs, override] = await Promise.all([forecastRunsSince(restaurantId, since), forecastOverride(restaurantId)]);
  const todays = runs.filter((r) => londonYmd(new Date(r.started_at)) === today);
  for (const { run, unvalidated } of usableRuns(todays, override)) {
    const data = await forecastFromRun(restaurantId, run.id, today, toDay);
    if (!data.ok || !data.forecasts.some((f) => f.target_day === today && f.channel === "all")) continue;
    let days = byDay(data.forecasts, data.drivers);
    let metrics = run.metrics;
    let isTest = unvalidated || data.unvalidated;
    // A refresh covers days 0 to 2: the rest (and the pass details) come from its 05:35 run.
    const baseId = run.model_name === REFRESH_MODEL ? (run.metrics as { base_run_id?: string } | null)?.base_run_id : null;
    if (baseId) {
      const base = await forecastRun(restaurantId, baseId);
      const baseData = await forecastFromRun(restaurantId, baseId, today, toDay);
      if (base) metrics = base.metrics;
      if (baseData.ok) {
        const merged = byDay(baseData.forecasts, baseData.drivers);
        for (const [d, v] of days) {
          const m = merged.get(d);
          merged.set(d, {
            orders: v.orders ?? m?.orders ?? null,
            sales: v.sales ?? m?.sales ?? null,
            covers: v.covers ?? m?.covers ?? null,
            channels: v.channels.size ? v.channels : (m?.channels ?? new Map()),
            drivers: v.drivers.length ? v.drivers : (m?.drivers ?? []),
          });
        }
        days = merged;
        isTest = isTest || baseData.unvalidated;
      }
    }
    return { kind: "forecast", run, unvalidated: isTest, metrics, days };
  }
  const earlier = runs.filter((r) => londonYmd(new Date(r.started_at)) < today);
  const hadRecently = usableRuns(earlier, override).length > 0;
  return { kind: "none", hadRecently, reason: noForecastReason(todays) };
}

// ---------- What the restaurant's own sales say ----------

async function salesHistory(restaurantId: string, fromDay: string, toDay: string) {
  return (
    check(
      await getSupabase()
        .from("sales_days")
        .select("day, transactions, covers")
        .eq("restaurant_id", restaurantId)
        .gte("day", fromDay)
        .lte("day", toDay)
        .returns<{ day: string; transactions: number | null; covers: number | null }[]>(),
    ) ?? []
  ).map((r) => ({ day: r.day, orders: r.transactions, covers: r.covers }));
}

// Days the owner marked unusual (restaurant events with treat_as_unusual).
async function unusualDays(restaurantId: string, fromDay: string, toDay: string) {
  const events = await restaurantEventsBetween(restaurantId, `${fromDay}T00:00:00Z`, `${addDays(toDay, 1)}T00:00:00Z`);
  const days = new Set<string>();
  for (const e of events) {
    if (!e.treat_as_unusual) continue;
    let d = londonYmd(new Date(e.starts_at));
    const last = londonYmd(new Date(e.ends_at ?? e.starts_at));
    while (d <= last) {
      days.add(d);
      d = addDays(d, 1);
    }
  }
  return days;
}

async function dealNames(restaurantId: string, drivers: { factor: string }[]) {
  const ids = [...new Set(drivers.filter((d) => d.factor.startsWith("deal:")).map((d) => d.factor.slice(5)))];
  if (!ids.length) return new Map<string, string>();
  const rows = check(await getSupabase().from("campaigns").select("id, name").eq("restaurant_id", restaurantId).in("id", ids).returns<{ id: string; name: string }[]>()) ?? [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

// Every day's likely orders against a normal day of its weekday.
async function normalsFor(restaurantId: string, today: string, days: string[]) {
  const from = addDays(today, -7 * (FORECAST_CONFIG.normalWeeks + 2));
  const [history, unusual] = await Promise.all([salesHistory(restaurantId, from, addDays(today, -1)), unusualDays(restaurantId, from, today)]);
  return { history, normals: new Map(days.map((d) => [d, normalDay(d, today, history, unusual)])) };
}

// ---------- The brief ----------

async function briefRow(restaurantId: string, day: string) {
  return check(await getSupabase().from("forecast_briefs").select("*").eq("restaurant_id", restaurantId).eq("day", day).maybeSingle<ForecastBriefRow>());
}

async function shownBefore(restaurantId: string, today: string) {
  const res = await getSupabase().from("forecast_briefs").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).eq("status", "shown").lt("day", today);
  if (res.error) throw new Error(res.error.message);
  return (res.count ?? 0) > 0;
}

// Yesterday's orders against what yesterday's brief showed. null when yesterday's
// sales aren't in (the till report nudge says so instead).
async function yesterdayFor(restaurantId: string, today: string) {
  const day = addDays(today, -1);
  const [shown, sales] = await Promise.all([
    briefRow(restaurantId, day),
    getSupabase().from("sales_days").select("transactions").eq("restaurant_id", restaurantId).eq("day", day).maybeSingle<{ transactions: number | null }>(),
  ]);
  const actual = check(sales);
  if (!shown || shown.status !== "shown" || !actual) return null;
  return yesterdayLine({ orders_low: num(shown.orders_low), orders_high: num(shown.orders_high) }, actual.transactions);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// Was the quiet day already offered (or is an offer already planned for it)?
async function alreadyOffered(restaurantId: string, today: string, day: string) {
  const rows =
    check(
      await getSupabase()
        .from("forecast_briefs")
        .select("offer")
        .eq("restaurant_id", restaurantId)
        .gte("day", addDays(today, -FORECAST_CONFIG.offerToDays))
        .lt("day", today)
        .returns<{ offer: OfferRecord | null }[]>(),
    ) ?? [];
  if (rows.some((r) => r.offer?.day === day && r.offer.status !== "blocked")) return true;
  const planned = check(
    await getSupabase()
      .from("campaigns")
      .select("id", { count: "exact" })
      .eq("restaurant_id", restaurantId)
      .eq("is_birthday", false)
      .lte("valid_from", day)
      .gte("valid_until", day)
      .gte("created_at", new Date(Date.now() - 14 * DAY_MS).toISOString())
      .limit(1)
      .returns<{ id: string }[]>(),
  );
  return Boolean(planned?.length);
}

// The 7-day gap: could anyone get an offer email by the morning before that day?
async function offerGap(restaurant: Restaurant, f: Flag) {
  const [y, m, d] = addDays(f.day, -1).split("-").map(Number);
  const at = londonTime(y, m, d, 10, 0);
  const { eligible, limited } = await recipientsFor(restaurant, "everyone", at);
  if (eligible.length) return { ok: true as const };
  if (!limited) return { ok: false as const, nobody: true as const };
  const last = check(
    await getSupabase()
      .from("campaigns")
      .select("sent_at")
      .eq("restaurant_id", restaurant.id)
      .eq("is_birthday", false)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ sent_at: string }>(),
  );
  return { ok: false as const, nobody: false as const, lastSent: last ? londonYmd(new Date(last.sent_at)) : null };
}

export type BriefForecast = { block: string | null; offer: { id: string; question: string } | null };

// The forecast lines for this morning's brief, made once a day and saved
// (forecast_briefs), so a retry, the GM's brief and today's brief all show the
// same text. Never stops the brief: a failure here leaves the forecast out.
export async function briefForecast(restaurant: Restaurant, now: Date): Promise<BriefForecast> {
  try {
    const today = londonYmd(now);
    // Made once a day; made again only if a newer forecast run has started since (e.g.
    // RUN BRIEF before the 07:00 refresh). An answered offer is kept.
    const saved = await briefRow(restaurant.id, today);
    const stale = saved ? (await forecastRunsSince(restaurant.id, saved.updated_at)).length > 0 : true;
    const row = saved && !stale ? saved : await buildBriefRow(restaurant, today, now, saved);
    if (!row) return { block: null, offer: null };
    const offer = row.offer?.status === "offered" && row.offer.question ? { id: row.id, question: row.offer.question } : null;
    return { block: row.block, offer };
  } catch (err) {
    console.error("The forecast for the brief failed; the brief goes without it", err);
    await alertBuilder(`forecast-brief-error:${restaurant.id}`, `Forecast: the brief for ${restaurant.name} went without its forecast: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    return { block: null, offer: null };
  }
}

async function buildBriefRow(restaurant: Restaurant, today: string, now: Date, previous: ForecastBriefRow | null) {
  const rid = restaurant.id;
  const toDay = addDays(today, FORECAST_CONFIG.flagDaysAhead);
  const loaded = await loadForecast(rid, today, toDay);
  const base = { restaurant_id: rid, day: today, flags: [] as Flag[], offer: null as OfferRecord | null };

  if (loaded.kind === "none") {
    const status = forecastStatus({ haveToday: false, hadRecently: loaded.hadRecently });
    // Had a forecast recently: the owner sees one line, the builder hears why (never the owner).
    if (status === "no_forecast") await alertBuilder(`forecast-missing:${rid}:${today}`, `Forecast: no forecast in ${restaurant.name}'s brief today (${today}): ${loaded.reason}.`);
    return saveRow({ ...base, status, reason: loaded.reason, block: composeForecastBlock({ ...emptyBlock(today), status }) });
  }

  const todayData = loaded.days.get(today)!;
  const dayList = [...loaded.days.keys()].filter((d) => d > today).sort();
  const allDrivers = [...loaded.days.values()].flatMap((d) => d.drivers);
  const [names, { history, normals }, yesterday, before] = await Promise.all([
    dealNames(rid, allDrivers),
    normalsFor(rid, today, dayList),
    yesterdayFor(rid, today),
    shownBefore(rid, today),
  ]);
  const orders = todayData.orders ? roundCount(todayData.orders) : null;
  const sales = todayData.sales ? roundSales(todayData.sales) : null;
  const shownChannels = channelsToShow(loaded.metrics)
    .filter((c) => todayData.channels.has(c))
    .map((channel) => ({ channel, range: roundCount(todayData.channels.get(channel)!) }));
  const covers = todayData.covers && coversRecorded(history, today) ? roundCount(todayData.covers) : null;
  const reasons = reasonsFor(todayData.drivers, { today: true, dealNames: names });
  const flags = daysAheadFlags(
    today,
    dayList.filter((d) => loaded.days.get(d)?.orders).map((d) => ({ day: d, likely: loaded.days.get(d)!.orders!.likely, reasons: reasonsFor(loaded.days.get(d)!.drivers, { today: false, dealNames: names }) })),
    normals,
  );

  // The quiet-night offer: a button, or a plain line if the 7-day gap blocks it.
  let offer: OfferRecord | null = null;
  let blockedOffer: string | null = null;
  const quiet = offerDay(flags);
  const answered = previous?.offer && (previous.offer.status === "drafted" || previous.offer.status === "declined") ? previous.offer : null;
  if (answered) offer = answered;
  else if (quiet && !(await alreadyOffered(rid, today, quiet.day))) {
    const gap = await offerGap(restaurant, quiet);
    const facts = { day: quiet.day, likely: quiet.likely, normal: quiet.normal, pct: quiet.pct, reason: quiet.reason };
    if (gap.ok) offer = { ...facts, status: "offered", question: offerQuestion(quiet) };
    else if (!gap.nobody) {
      blockedOffer = offerBlockedLine(quiet, gap.lastSent);
      offer = { ...facts, status: "blocked" };
    }
  }

  const block = composeForecastBlock({
    status: "shown",
    today,
    unvalidated: loaded.unvalidated,
    orders,
    sales,
    channels: shownChannels,
    covers,
    reasons,
    yesterday,
    flags,
    blockedOffer,
    footnote: showFootnote({ shownBefore: before, londonWeekday: londonWeekday(now) }),
  });
  return saveRow({
    ...base,
    status: "shown",
    reason: null,
    run_id: loaded.run.id,
    run_name: loaded.run.model_name,
    unvalidated: loaded.unvalidated,
    orders_low: orders?.low ?? null,
    orders_likely: orders?.likely ?? null,
    orders_high: orders?.high ?? null,
    sales_likely: sales?.likely ?? null,
    block,
    flags,
    offer,
  });
}

function emptyBlock(today: string) {
  return { today, unvalidated: false, orders: null, sales: null, channels: [], covers: null, reasons: [] as Reason[], yesterday: null, flags: [], blockedOffer: null, footnote: false };
}

async function saveRow(fields: Partial<ForecastBriefRow> & { restaurant_id: string; day: string; status: ForecastBriefRow["status"] }) {
  // Every column, so making the row again never leaves an old value behind.
  const empty = { reason: null, run_id: null, run_name: null, unvalidated: false, orders_low: null, orders_likely: null, orders_high: null, sales_likely: null, block: null };
  const res = await getSupabase()
    .from("forecast_briefs")
    .upsert({ ...empty, ...fields, updated_at: new Date().toISOString() }, { onConflict: "restaurant_id,day" })
    .select("*")
    .single<ForecastBriefRow>();
  return check(res);
}

// The quiet-night offer was answered (drafted, or Not now).
export async function markOffer(restaurantId: string, rowId: string, change: Partial<OfferRecord>) {
  const row = check(await getSupabase().from("forecast_briefs").select("*").eq("restaurant_id", restaurantId).eq("id", rowId).maybeSingle<ForecastBriefRow>());
  if (!row?.offer) return null;
  const offer = { ...row.offer, ...change };
  check(await getSupabase().from("forecast_briefs").update({ offer, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("id", rowId));
  return { ...row, offer };
}

export async function forecastBriefById(restaurantId: string, rowId: string) {
  return check(await getSupabase().from("forecast_briefs").select("*").eq("restaurant_id", restaurantId).eq("id", rowId).maybeSingle<ForecastBriefRow>());
}

// The latest brief's offer still waiting for an answer (for a typed DRAFT OFFER).
export async function latestOpenOffer(restaurantId: string, today: string) {
  const rows =
    check(
      await getSupabase()
        .from("forecast_briefs")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("day", addDays(today, -FORECAST_CONFIG.offerToDays))
        .order("day", { ascending: false })
        .limit(7)
        .returns<ForecastBriefRow[]>(),
    ) ?? [];
  return rows.find((r) => r.offer?.status === "offered" && r.offer.day > today) ?? null;
}

// ---------- The assistant's look_up_forecast ----------

export type ForecastLookUp = { lines: string[]; unvalidated: boolean; status: "shown" | "no_forecast" | "none" };

// Forecasts from today's usable run for a span of days (at most 14 ahead), as ranges with reasons.
export async function lookUpForecast(restaurant: Pick<Restaurant, "id">, now: Date, fromDay?: string, toDay?: string): Promise<ForecastLookUp> {
  const today = londonYmd(now);
  const last = addDays(today, FORECAST_CONFIG.lookUpDays);
  const from = fromDay && fromDay >= today && fromDay <= last ? fromDay : today;
  const to = toDay && toDay >= from && toDay <= last ? toDay : from > addDays(today, 6) ? from : addDays(today, 6);
  const loaded = await loadForecast(restaurant.id, today, last);
  if (loaded.kind === "none") {
    return loaded.hadRecently
      ? { lines: ["No forecast today: today's forecast didn't come through."], unvalidated: false, status: "no_forecast" }
      : { lines: ["No forecast is available for this restaurant yet."], unvalidated: false, status: "none" };
  }
  const days = [...loaded.days.keys()].filter((d) => d >= from && d <= to).sort();
  const [names, { normals }] = await Promise.all([dealNames(restaurant.id, days.flatMap((d) => loaded.days.get(d)!.drivers)), normalsFor(restaurant.id, today, days)]);
  const out: LookUpDay[] = days.map((d) => {
    const v = loaded.days.get(d)!;
    const normal = normals.get(d);
    return {
      day: d,
      orders: v.orders ? roundCount(v.orders) : null,
      sales: v.sales ? roundSales(v.sales) : null,
      reasons: reasonsFor(v.drivers, { today: d === today, dealNames: names }),
      vsNormalPct: v.orders && normal ? Math.round((v.orders.likely / normal - 1) * 100) : null,
    };
  });
  return { lines: lookUpLines(out, loaded.unvalidated), unvalidated: loaded.unvalidated, status: "shown" };
}

// ---------- The Monday report and /log ----------

// Each day's orders against the range its brief showed (days with both).
export async function forecastReportDays(restaurantId: string, fromDay: string, toDay: string) {
  const [rows, sales] = await Promise.all([
    getSupabase()
      .from("forecast_briefs")
      .select("day, status, unvalidated, orders_low, orders_high")
      .eq("restaurant_id", restaurantId)
      .eq("status", "shown")
      .gte("day", fromDay)
      .lte("day", toDay)
      .returns<Pick<ForecastBriefRow, "day" | "status" | "unvalidated" | "orders_low" | "orders_high">[]>(),
    salesHistory(restaurantId, fromDay, toDay),
  ]);
  const actual = new Map(sales.map((s) => [s.day, s.orders]));
  const shown = check(rows) ?? [];
  return {
    unvalidated: shown.some((r) => r.unvalidated),
    days: shown
      .filter((r) => r.orders_low !== null && r.orders_high !== null && actual.get(r.day) != null)
      .map((r) => ({ day: r.day, low: Number(r.orders_low), high: Number(r.orders_high), actual: actual.get(r.day)! }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// Today's row for every restaurant (the builder's view on /log).
export async function forecastBriefsOn(day: string, restaurantIds: string[]) {
  if (!restaurantIds.length) return [];
  return check(await getSupabase().from("forecast_briefs").select("*").eq("day", day).in("restaurant_id", restaurantIds).returns<ForecastBriefRow[]>()) ?? [];
}

// ---------- The builder's demo override ----------

// Turns the demo override on or off. Refused unless TEST_TOOLS is on and the
// restaurant is a demo one (the database also refuses it on a real restaurant).
export async function setForecastUnvalidated(restaurantId: string, on: boolean) {
  const r = check(await getSupabase().from("restaurants").select("id, name, is_demo").eq("id", restaurantId).maybeSingle<{ id: string; name: string; is_demo: boolean }>());
  if (!r) return { ok: false as const, message: "Restaurant not found." };
  if (on && !unvalidatedForecastsAllowed(process.env, { is_demo: r.is_demo, forecast_unvalidated: true })) {
    return { ok: false as const, message: "Unvalidated forecasts can only be shown for a demo restaurant, with TEST_TOOLS on." };
  }
  check(await getSupabase().from("restaurants").update({ forecast_unvalidated: on }).eq("id", restaurantId));
  // Today's saved forecast lines were made with the old setting: the next brief makes them again.
  check(await getSupabase().from("forecast_briefs").delete().eq("restaurant_id", restaurantId).eq("day", londonYmd(new Date())));
  await logAction({
    restaurantId,
    actor: "builder",
    action: "builder_command",
    detail: `Unvalidated (TEST) forecasts ${on ? "shown" : "hidden"} for ${r.name}`,
    data: { field: "forecast_unvalidated", after: on },
  });
  return { ok: true as const, message: on ? "Forecasts from runs that didn't pass will show, labelled TEST." : "Only forecasts that passed will show." };
}
