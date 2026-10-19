import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { distanceMetres } from "@/lib/ops/outside";
import { PermanentJobError, type JobHandler } from "@/lib/queue/registry";
import type { QueueJob } from "@/lib/queue/store";
import { getSupabase } from "@/lib/supabase";
import { AUTHORITIES, addDays, bankHolidayRows, clockChangeRows, culturalRows, paydayRows, religiousRows } from "./calendar-dates";
import { EVENTS_RADIUS_KM, HORIZON } from "./config";
import { COMPETITIONS, fixtureRows, matchesUrl, type MatchesAnswer, type Venue } from "./football";
import { premierLeagueHistory } from "./football-history";
import { getJson } from "./http";
import { ensureLocated } from "./location";
import { ensureVenues } from "./venues";
import { wait as sleep } from "./wait";
import { computedPrayerRows } from "./prayer";
import { councilsShort, datesKnownUntil, holidayRows, type SchoolDate } from "./school-terms";
import { addRows, runFeed, type FeedOutcome } from "./status";
import { calendarIds, insertForecasts, removeFeedRows, saveRelevance, upsertCalendar, upsertFixtures } from "./store";
import { disruptionRows, linesUrl, nearbyLines, stationsUrl, statusUrl, type StationsAnswer, type StatusAnswer } from "./tfl";
import { eventRows, eventsUrl, lastPage, type EventsAnswer } from "./ticketmaster";
import type { CalendarFeedRow } from "./types";
import {
  archiveUrl, cellCentre, dayActuals, forecastRows, forecastUrl, hourActuals, MODEL_META_URL, modelRunAt, previousRunRows,
  previousRunsUrl, PROVIDER, type HourActual, type OpenMeteoAnswer,
} from "./weather-data";

// The outside data feeds' jobs on the queue (registered in lib/queue/handlers.ts).
// Each writes app tables only; the analytics service reads them through the
// analytics views. Every row has source = feed (or builder), an external id
// where there is one, and when it was fetched; a re-run never duplicates.

type FeedRestaurantRow = {
  id: string;
  name: string;
  active: boolean;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  council_code: string | null;
  council_name: string | null;
  nation: string | null;
  weather_cell: string | null;
  prayer_method: string | null;
  outside_backfilled_at: string | null;
};
const RESTAURANT_COLUMNS = "id, name, active, address, latitude, longitude, council_code, council_name, nation, weather_cell, prayer_method, outside_backfilled_at";

async function restaurantsById(ids: string[]) {
  if (!ids.length) return [];
  return check(await getSupabase().from("restaurants").select(RESTAURANT_COLUMNS).in("id", ids).returns<FeedRestaurantRow[]>()) ?? [];
}
async function activeRestaurants() {
  return check(await getSupabase().from("restaurants").select(RESTAURANT_COLUMNS).eq("active", true).order("created_at").returns<FeedRestaurantRow[]>()) ?? [];
}
async function oneRestaurant(job: QueueJob) {
  if (!job.restaurant_id) throw new PermanentJobError("This job has no restaurant");
  const [r] = await restaurantsById([job.restaurant_id]);
  return r ?? null;
}

async function venues(): Promise<(Venue & { ticketmaster_id: string | null })[]> {
  await ensureVenues();
  const rows = check(await getSupabase().from("venues").select("id, name, latitude, longitude, capacity, typical_crowd, teams, ticketmaster_id").returns<(Venue & { ticketmaster_id: string | null })[]>()) ?? [];
  return rows.map((v) => ({ ...v, latitude: Number(v.latitude), longitude: Number(v.longitude) }));
}

const today = () => londonYmd(new Date());

// ---------- Weather ----------

async function saveActuals(restaurantIds: string[], hours: HourActual[], provider: string, fetchedAt: string, daySource: "archive" | "recent") {
  const supabase = getSupabase();
  const days = dayActuals(hours);
  for (const id of restaurantIds) {
    for (let i = 0; i < hours.length; i += 500) {
      check(
        await supabase
          .from("weather_hours")
          .upsert(hours.slice(i, i + 500).map((h) => ({ restaurant_id: id, ...h, provider, source: "feed", fetched_at: fetchedAt })), { onConflict: "restaurant_id,hour_start" }),
      );
    }
    for (let i = 0; i < days.length; i += 500) {
      check(
        await supabase
          .from("weather_days")
          .upsert(days.slice(i, i + 500).map((d) => ({ restaurant_id: id, ...d, source: daySource, fetched_at: fetchedAt })), { onConflict: "restaurant_id,day" }),
      );
    }
  }
  return { weather_hours: hours.length * restaurantIds.length, weather_days: days.length * restaurantIds.length };
}

// Restaurants of a weather job: a cell's (still in it), or one not located yet (it gets its cell now).
async function weatherTargets(job: QueueJob) {
  const p = job.payload as { cell?: string; restaurants?: string[] };
  const rows = (await restaurantsById(p.restaurants ?? (job.restaurant_id ? [job.restaurant_id] : []))).filter((r) => r.active);
  if (p.cell && !p.cell.startsWith("restaurant:")) return { cell: p.cell, ids: rows.filter((r) => r.weather_cell === p.cell).map((r) => r.id) };
  const r = rows[0];
  if (!r) return { cell: null, ids: [] };
  const where = await ensureLocated(r);
  return where ? { cell: where.cell, ids: [r.id] } : { cell: null, ids: [] };
}

// Daily (04:30): the last days' actuals (the archive where it has them, else the
// forecast model's own recent hours) and the forecast as issued. Refresh (06:45):
// the forecast as issued again, for the 07:00 forecast refresh.
export async function weatherForCell(cell: string, ids: string[], mode: "daily" | "refresh", now = new Date()) {
  const centre = cellCentre(cell);
  const fetchedAt = now.toISOString();
  const rows: Record<string, number> = {};
  const meta = await getJson<{ last_run_initialisation_time?: number }>(MODEL_META_URL, { cacheKey: "open-meteo:meta", maxAgeMs: 20 * 60_000 }).catch(() => null);
  const forecast = await getJson<OpenMeteoAnswer>(forecastUrl(centre));
  const recent = hourActuals(forecast, now);
  if (mode === "daily") {
    addRows(rows, await saveActuals(ids, recent, PROVIDER.forecast, fetchedAt, "recent"));
    // The archive (ERA5) runs about 5 days behind; its hours replace the forecast model's once it has them.
    const archive = await getJson<OpenMeteoAnswer>(archiveUrl(centre, addDays(today(), -12), addDays(today(), -1)), { cacheKey: `archive:${cell}:${today()}`, maxAgeMs: 20 * 3_600_000 });
    const archived = hourActuals(archive);
    if (archived.length) addRows(rows, await saveActuals(ids, archived, PROVIDER.archive, fetchedAt, "archive"));
  } else {
    addRows(rows, await saveActuals(ids, recent.filter((h) => h.hour_start >= addDays(today(), -1)), PROVIDER.forecast, fetchedAt, "recent"));
  }
  const { days, hours } = forecastRows(forecast, now, modelRunAt(meta));
  const issued = ids.flatMap((id) => [...days, ...hours].map((f) => ({ restaurant_id: id, ...f, source: "feed" })));
  rows.weather_forecasts = await insertForecasts(issued);
  const ymd = londonYmd(now);
  check(await getSupabase().from("restaurants").update({ last_weather_on: ymd }).in("id", ids));
  return rows;
}

const weatherJob: JobHandler = {
  run: async (job) => {
    const mode = job.payload.mode === "refresh" ? "refresh" : "daily";
    const out = await runFeed("weather", async (): Promise<FeedOutcome> => {
      const { cell, ids } = await weatherTargets(job);
      if (!cell || !ids.length) return { skipped: "no located restaurant in this cell" };
      return { rows: await weatherForCell(cell, ids, mode), detail: { cell, restaurants: ids.length, mode } };
    });
    return out as Record<string, unknown>;
  },
};

// ---------- The calendar ----------

export async function calendarRows(fromYear: number, toYear: number, now = new Date()) {
  const fetchedAt = now.toISOString();
  const gov = await getJson<Parameters<typeof bankHolidayRows>[0]>("https://www.gov.uk/bank-holidays.json", { cacheKey: "gov.uk:bank-holidays", maxAgeMs: 20 * 3_600_000 });
  const bank = bankHolidayRows(gov, fetchedAt).filter((r) => Number(r.day.slice(0, 4)) >= fromYear);
  const bankDays = new Set(bank.map((b) => b.day));
  const rows: CalendarFeedRow[] = [
    ...bank,
    ...AUTHORITIES.flatMap((a) => religiousRows(a, fromYear, toYear, fetchedAt)),
    ...culturalRows(fromYear, toYear, fetchedAt),
    ...clockChangeRows(fromYear, toYear, fetchedAt),
    ...paydayRows(fromYear, toYear, bankDays, fetchedAt),
  ];
  return rows;
}

// School holidays and inset days, made again from every council's saved dates.
export async function schoolCalendar(now = new Date()) {
  const supabase = getSupabase();
  const councils = check(await supabase.from("councils").select("code, name").returns<{ code: string; name: string }[]>()) ?? [];
  const dates = check(await supabase.from("school_dates").select("council_code, kind, start_day, end_day, half_term_start, half_term_end, notes").returns<SchoolDate[]>()) ?? [];
  const rows = councils.flatMap((c) => holidayRows(c.code, c.name, dates, now.toISOString()));
  const counts = await upsertCalendar(rows);
  // Holidays that are no longer in the dates (the builder changed a term): taken out.
  const keep = new Set(rows.map((r) => r.external_id));
  const existing = check(await supabase.from("local_calendar").select("external_id").is("restaurant_id", null).eq("external_source", "school-dates").returns<{ external_id: string }[]>()) ?? [];
  const removed = await removeFeedRows("school-dates", existing.map((e) => e.external_id).filter((id) => !keep.has(id)));
  for (const c of councils) {
    const until = datesKnownUntil(dates.filter((d) => d.council_code === c.code));
    check(await supabase.from("councils").update({ dates_known_until: until, updated_at: now.toISOString() }).eq("code", c.code));
  }
  return { school_rows: rows.length, school_added: counts.inserted, school_removed: removed };
}

const calendarJob: JobHandler = {
  run: async (job) => {
    const out = await runFeed("calendar", async () => {
      const year = Number(today().slice(0, 4));
      const fromYear = typeof job.payload.fromYear === "number" ? job.payload.fromYear : year - 1;
      const rows = await calendarRows(fromYear, year + HORIZON.calendarYears);
      const counts = await upsertCalendar(rows);
      const school = await schoolCalendar();
      return { rows: { calendar_rows: rows.length, added: counts.inserted, changed: counts.updated, kept_confirmed: counts.kept, ...school }, detail: { fromYear } };
    });
    return out as Record<string, unknown>;
  },
};

// Every active restaurant's council has dates for the next 4 months (builder alert if not).
const termsCheckJob: JobHandler = {
  run: async () => {
    const out = await runFeed("school_terms", async () => {
      const supabase = getSupabase();
      const restaurants = await activeRestaurants();
      const noCouncil = restaurants.filter((r) => !r.council_code);
      for (const r of noCouncil) {
        await alertBuilder(`terms-no-council:${r.id}:${today()}`, `${r.name} has no council yet (needed for school holidays). Check its address has a postcode; the weather feed fills the council from it.`);
      }
      const councils = check(await supabase.from("councils").select("code, name, dates_known_until").returns<{ code: string; name: string; dates_known_until: string | null }[]>()) ?? [];
      const short = councilsShort(councils, restaurants.map((r) => r.council_code).filter((c): c is string => Boolean(c)), today(), HORIZON.termWarningMonths);
      for (const c of short) {
        await alertBuilder(
          `terms:${c.code}:${today()}`,
          `School dates for ${c.name} ${c.knownUntil ? `run out on ${c.knownUntil}` : "aren't entered yet"}: add the next terms on /feeds/terms (the forecast treats days after that as term time).`,
        );
      }
      return { rows: { councils_checked: new Set(restaurants.map((r) => r.council_code)).size, short: short.length, no_council: noCouncil.length }, detail: { short } };
    });
    return out as Record<string, unknown>;
  },
};

// ---------- Prayer times ----------

export async function prayerFor(r: FeedRestaurantRow, from: string, to: string) {
  const where = await ensureLocated(r);
  if (!where) return null;
  const fetched_at = new Date().toISOString();
  const rows = computedPrayerRows(where.lat, where.lon, from, to);
  for (let i = 0; i < rows.length; i += 500) {
    check(
      await getSupabase()
        .from("prayer_times")
        .upsert(rows.slice(i, i + 500).map((p) => ({ restaurant_id: r.id, ...p, source: "feed", fetched_at })), { onConflict: "restaurant_id,day,method" }),
    );
  }
  return rows.length;
}

const prayerJob: JobHandler = {
  run: async (job) => {
    const r = await oneRestaurant(job);
    if (!r?.active) return { skipped: "restaurant not active" };
    const out = await runFeed("prayer", async () => {
      const n = await prayerFor(r, addDays(today(), -1), addDays(today(), HORIZON.prayerDays));
      return n === null ? { skipped: `${r.name} has no address to work prayer times out from` } : { rows: { prayer_times: n } };
    });
    return out as Record<string, unknown>;
  },
};

// ---------- Football ----------

const footballHeaders = () => ({ "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY ?? "" });

export async function footballFixtures(from: string, to: string) {
  const vs = await venues();
  const rows: Record<string, number> = {};
  const detail: Record<string, string> = {};
  for (const [i, code] of COMPETITIONS.entries()) {
    // The free tier allows 10 calls a minute: one every 7 seconds is well inside it.
    if (i) await sleep(7_000);
    let answer: MatchesAnswer;
    try {
      answer = await getJson<MatchesAnswer>(matchesUrl(code, from, to), { headers: footballHeaders(), cacheKey: `football-data:${code}:${from}:${to}`, maxAgeMs: 6 * 3_600_000 });
    } catch (err) {
      // A competition the plan doesn't include (403), or not running (404): noted, the others still go in.
      const status = (err as { status?: number }).status;
      if (status === 403 || status === 404) {
        detail[code] = status === 403 ? "not on this plan" : "no matches";
        continue;
      }
      throw err;
    }
    const { rows: matches, removed } = fixtureRows(answer, vs, new Date().toISOString());
    const c = await upsertFixtures(matches);
    addRows(rows, { [`${code}_matches`]: matches.length, added: c.inserted, changed: c.updated, removed: await removeFeedRows("football-data.org", removed) });
  }
  return { rows, detail };
}

const footballJob: JobHandler = {
  run: async (job) => {
    const out = await runFeed("football", async () => {
      const t = today();
      const result = await footballFixtures(t, addDays(t, HORIZON.fixturesDays));
      // Backfill: past Premier League fixtures with kick-offs (football-data.co.uk, as the generator).
      if (typeof job.payload.historyFrom === "string") {
        const past = await premierLeagueHistory(job.payload.historyFrom, addDays(t, -1), await venues());
        const c = await upsertFixtures(past);
        addRows(result.rows, { history_matches: past.length, history_added: c.inserted });
      }
      return result;
    });
    return out as Record<string, unknown>;
  },
};

// ---------- Local events ----------

export async function eventsFor(r: FeedRestaurantRow, now = new Date()) {
  const key = process.env.TICKETMASTER_API_KEY ?? "";
  const where = await ensureLocated(r);
  if (!where) return null;
  const vs = await venues();
  const to = new Date(now.getTime() + HORIZON.eventsDays * 86_400_000);
  const rows: Record<string, number> = { events: 0, added: 0, removed: 0, relevance: 0 };
  for (let page = 0; ; page++) {
    const json = await getJson<EventsAnswer>(eventsUrl(key, where, now, to, page, EVENTS_RADIUS_KM), {
      timeoutMs: 30_000,
      // Not cached: Ticketmaster's terms only allow keeping its content as long as the service needs it.
    });
    const { rows: events, removed } = eventRows(json, vs, now.toISOString());
    // (The two venue ids ride along; the database function reads only calendar fields.)
    const counts = await upsertCalendar(events);
    // Our venues learn their Ticketmaster id the first time an event there is seen.
    for (const e of events) {
      const v = vs.find((x) => x.id === e.matched_venue_id);
      if (v && e.tm_venue_id && !v.ticketmaster_id) {
        check(await getSupabase().from("venues").update({ ticketmaster_id: e.tm_venue_id }).eq("id", v.id).is("ticketmaster_id", null));
        v.ticketmaster_id = e.tm_venue_id;
      }
    }
    const ids = await calendarIds("ticketmaster", events.map((e) => e.external_id));
    const near = events
      .filter((e) => e.latitude != null && e.longitude != null && ids.has(e.external_id))
      .map((e) => ({ event_id: ids.get(e.external_id)!, distance_m: distanceMetres({ lat: where.lat, lon: where.lon }, { lat: Number(e.latitude), lon: Number(e.longitude) }) }))
      .filter((x) => x.distance_m <= EVENTS_RADIUS_KM * 1000);
    rows.relevance += await saveRelevance(r.id, near);
    rows.events += events.length;
    rows.added += counts.inserted;
    rows.removed += await removeFeedRows("ticketmaster", removed);
    if (page >= lastPage(json)) break;
    await sleep(300); // 5 calls a second at most
  }
  return rows;
}

const eventsJob: JobHandler = {
  run: async (job) => {
    const r = await oneRestaurant(job);
    if (!r?.active) return { skipped: "restaurant not active" };
    const out = await runFeed("events", async () => {
      const rows = await eventsFor(r);
      return rows === null ? { skipped: `${r.name} has no address to look for events near` } : { rows };
    });
    return out as Record<string, unknown>;
  },
};

// ---------- Disruption ----------

export async function disruption(now = new Date()) {
  const key = process.env.TFL_API_KEY?.trim() || undefined;
  const lines = await getJson<{ id: string }[]>(linesUrl(key), { cacheKey: "tfl:lines", maxAgeMs: 7 * 86_400_000 });
  const from = londonYmd(now);
  const to = addDays(from, HORIZON.disruptionDays);
  const status: StatusAnswer = [];
  for (let i = 0; i < lines.length; i += 20) {
    status.push(...(await getJson<StatusAnswer>(statusUrl(lines.slice(i, i + 20).map((l) => l.id), from, to, key))));
  }
  const { strikes, closures } = disruptionRows(status, now.toISOString());
  const counts = await upsertCalendar([...strikes, ...closures]);
  // A closure matters to the restaurants with a station on that line within 1 km.
  let relevance = 0;
  if (closures.length) {
    const ids = await calendarIds("tfl", closures.map((c) => c.external_id));
    for (const r of await activeRestaurants()) {
      if (r.latitude == null || r.longitude == null) continue;
      const near = nearbyLines(
        await getJson<StationsAnswer>(stationsUrl({ lat: Number(r.latitude), lon: Number(r.longitude) }, key), {
          cacheKey: `tfl:stations:${Number(r.latitude).toFixed(4)},${Number(r.longitude).toFixed(4)}`,
          maxAgeMs: 30 * 86_400_000,
        }),
      );
      const rows = closures.filter((c) => near.includes(c.line) && ids.has(c.external_id)).map((c) => ({ event_id: ids.get(c.external_id)!, distance_m: 0 }));
      relevance += await saveRelevance(r.id, rows);
    }
  }
  return { rows: { strikes: strikes.length, closures: closures.length, added: counts.inserted, changed: counts.updated, relevance }, detail: { lines: lines.length, with_key: Boolean(key) } };
}

const disruptionJob: JobHandler = {
  run: async () => (await runFeed("disruption", () => disruption())) as Record<string, unknown>,
};

export const FEED_JOB_HANDLERS: Record<string, JobHandler> = {
  feed_weather: weatherJob,
  feed_calendar: calendarJob,
  feed_prayer: prayerJob,
  feed_football: footballJob,
  feed_events: eventsJob,
  feed_disruption: disruptionJob,
  feed_terms_check: termsCheckJob,
};

export { RESTAURANT_COLUMNS, restaurantsById, saveActuals, type FeedRestaurantRow };

// Archived actuals for a cell (a year at a time) and archived forecasts (92 days
// at a time), for the backfill. Not cached: each restaurant's history is fetched once.
export async function archiveForCell(cell: string, from: string, to: string) {
  return hourActuals(await getJson<OpenMeteoAnswer>(archiveUrl(cellCentre(cell), from, to), { timeoutMs: 90_000 }));
}
export async function previousRunsForCell(cell: string, from: string, to: string) {
  return previousRunRows(await getJson<OpenMeteoAnswer>(previousRunsUrl(cellCentre(cell), from, to), { timeoutMs: 90_000 }));
}

// The feeds' cached answers older than a week (cached_data), cleared by the daily clean-up.
export async function clearFeedCache(now = new Date()) {
  const before = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from("cached_data")
    .delete()
    .lt("fetched_at", before)
    .or("key.like.football-data:*,key.like.archive:*,key.like.open-meteo:*,key.like.postcode:*")
    .select("key");
  if (error) throw new Error(`clear feed cache: ${error.message}`);
  return data?.length ?? 0;
}
