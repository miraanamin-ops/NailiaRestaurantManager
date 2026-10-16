import "server-only";
import { forecastForDay, forecastForHour } from "./known-at";
import { db, must } from "./db";
import type {
  CalendarEventRow,
  CalendarRelevanceRow,
  OpsSource,
  PrayerTimesRow,
  RestaurantEventRow,
  RestaurantEventType,
  RestaurantTeamRow,
  WeatherForecastRow,
  WeatherHourRow,
} from "./types";

// Outside factors and the restaurant's own events (034_ops_outside.sql).

// ---------- Weather ----------

export async function weatherHours(restaurantId: string, fromIso: string, toIso: string) {
  return must(
    await db().from("weather_hours").select("*").eq("restaurant_id", restaurantId).gte("hour_start", fromIso).lt("hour_start", toIso).order("hour_start"),
    "hourly weather",
  ) as WeatherHourRow[];
}

// The forecast for a day as it was known at the cut-off: never one issued later.
export async function dayForecastKnownAt(restaurantId: string, day: string, cutoff: Date) {
  const rows = must(
    await db().from("weather_forecasts").select("*").eq("restaurant_id", restaurantId).eq("target_day", day).lte("issued_at", cutoff.toISOString()),
    "weather forecasts",
  ) as WeatherForecastRow[];
  return forecastForDay(rows, day, cutoff); // and checked again in code
}

export async function hourForecastKnownAt(restaurantId: string, hourStart: Date, cutoff: Date) {
  const rows = must(
    await db()
      .from("weather_forecasts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("hour_start", hourStart.toISOString())
      .lte("issued_at", cutoff.toISOString()),
    "weather forecasts",
  ) as WeatherForecastRow[];
  return forecastForHour(rows, hourStart, cutoff);
}

// ---------- Calendar ----------

// This restaurant's events and the shared ones that overlap the days.
export async function calendarBetween(restaurantId: string, fromDay: string, toDay: string) {
  const rows = must(
    await db()
      .from("local_calendar")
      .select("*")
      .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
      .lte("day", toDay)
      .order("day"),
    "calendar",
  ) as CalendarEventRow[];
  return rows.filter((e) => (e.end_day ?? e.day) >= fromDay);
}

// The owner or builder says whether an event matters to this restaurant.
export async function markRelevance(restaurantId: string, eventId: string, relevant: boolean | null, by: "owner" | "builder") {
  return must(
    await db()
      .from("calendar_relevance")
      .upsert(
        { restaurant_id: restaurantId, event_id: eventId, relevant, marked_by: by, marked_at: new Date().toISOString(), source: "manual" },
        { onConflict: "restaurant_id,event_id" },
      )
      .select("*")
      .single(),
    "mark relevance",
  ) as CalendarRelevanceRow;
}

// Metres between two points (haversine), as ops_distance_m in SQL.
export function distanceMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

export async function setTeams(restaurantId: string, teams: string[], source: OpsSource) {
  must(await db().from("restaurant_teams").delete().eq("restaurant_id", restaurantId), "clear teams");
  if (!teams.length) return [];
  return must(
    await db()
      .from("restaurant_teams")
      .insert(teams.map((team) => ({ restaurant_id: restaurantId, team, source })))
      .select("*"),
    "set teams",
  ) as RestaurantTeamRow[];
}

// ---------- Prayer times (stored per restaurant and day) ----------

export async function prayerTimes(restaurantId: string, fromDay: string, toDay: string, method?: string | null) {
  let q = db().from("prayer_times").select("*").eq("restaurant_id", restaurantId).gte("day", fromDay).lte("day", toDay).order("day");
  if (method) q = q.eq("method", method);
  return must(await q, "prayer times") as PrayerTimesRow[];
}

export async function savePrayerTimes(restaurantId: string, rows: Omit<PrayerTimesRow, "id" | "restaurant_id" | "created_at">[]) {
  if (!rows.length) return;
  must(
    await db()
      .from("prayer_times")
      .upsert(
        rows.map((r) => ({ restaurant_id: restaurantId, ...r })),
        { onConflict: "restaurant_id,day,method", ignoreDuplicates: true },
      ),
    "save prayer times",
  );
}

// ---------- The restaurant's own events ----------

export async function addRestaurantEvent(
  restaurantId: string,
  input: { type: RestaurantEventType; startsAt: string; endsAt?: string | null; treatAsUnusual?: boolean; campaignId?: string | null; notes?: string | null; source: OpsSource; createdBy?: string | null },
) {
  return must(
    await db()
      .from("restaurant_events")
      .insert({
        restaurant_id: restaurantId,
        type: input.type,
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        treat_as_unusual: input.treatAsUnusual ?? true,
        campaign_id: input.campaignId ?? null,
        notes: input.notes ?? null,
        source: input.source,
        created_by: input.createdBy ?? null,
      })
      .select("*")
      .single(),
    "add restaurant event",
  ) as RestaurantEventRow;
}

// Events that overlap a span of time (for "treat this period as unusual").
export async function restaurantEventsBetween(restaurantId: string, fromIso: string, toIso: string) {
  const rows = must(
    await db().from("restaurant_events").select("*").eq("restaurant_id", restaurantId).lt("starts_at", toIso).order("starts_at"),
    "restaurant events",
  ) as RestaurantEventRow[];
  return rows.filter((e) => !e.ends_at || e.ends_at > fromIso);
}
