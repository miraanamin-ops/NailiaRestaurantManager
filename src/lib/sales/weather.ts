import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { addDays, dayLabel } from "./format";
import { archiveUrl, postcodeOf, recentUrl, townOf, weatherRows, type WeatherRow } from "./weather-data";

// Each restaurant's daily weather (Open-Meteo, free, no key), stored for
// forecasting later. Once: the last 12 months. Then every day: the last week
// (so yesterday's real figures replace yesterday's forecast) and today.

type Located = Pick<Restaurant, "id" | "address"> & { latitude?: number | null; longitude?: number | null };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// Where the restaurant is: its saved position, else from the postcode
// (postcodes.io), else from the town name (Open-Meteo's place search).
export async function locate(r: Located): Promise<{ lat: number; lon: number } | null> {
  if (r.latitude != null && r.longitude != null) return { lat: Number(r.latitude), lon: Number(r.longitude) };
  let found: { lat: number; lon: number } | null = null;
  const postcode = postcodeOf(r.address);
  if (postcode) {
    try {
      const out = await getJson<{ result?: { latitude: number; longitude: number } }>(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
      if (out.result) found = { lat: out.result.latitude, lon: out.result.longitude };
    } catch (err) {
      console.warn("Postcode look-up failed; trying the town", err);
    }
  }
  const town = townOf(r.address);
  if (!found && town) {
    const out = await getJson<{ results?: { latitude: number; longitude: number }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: town, count: "1", countryCode: "GB" })}`,
    );
    if (out.results?.[0]) found = { lat: out.results[0].latitude, lon: out.results[0].longitude };
  }
  if (found) {
    check(await getSupabase().from("restaurants").update({ latitude: found.lat, longitude: found.lon }).eq("id", r.id));
  }
  return found;
}

async function store(restaurantId: string, rows: WeatherRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    check(
      await getSupabase()
        .from("weather_days")
        .upsert(
          rows.slice(i, i + 500).map((w) => ({ restaurant_id: restaurantId, ...w, fetched_at: new Date().toISOString() })),
          { onConflict: "restaurant_id,day" },
        ),
    );
  }
}

type WeatherRestaurant = Located & Pick<Restaurant, "name"> & { weather_backfilled_at?: string | null; last_weather_on?: string | null };

// Once a day per restaurant (from the hourly job). force: RUN WEATHER does it again now.
export async function runWeather(r: WeatherRestaurant, now: Date, { force = false } = {}) {
  const today = londonYmd(now);
  if (!force && r.last_weather_on === today && r.weather_backfilled_at) return { skipped: "already stored today" };
  const where = await locate(r);
  if (!where) return { skipped: "no address to find the weather for" };
  const supabase = getSupabase();
  let backfilled = 0;
  if (!r.weather_backfilled_at) {
    const rows = weatherRows(await getJson(archiveUrl(where.lat, where.lon, today)), "archive", today);
    await store(r.id, rows);
    backfilled = rows.length;
    check(await supabase.from("restaurants").update({ weather_backfilled_at: new Date().toISOString() }).eq("id", r.id));
  }
  const recent = weatherRows(await getJson(recentUrl(where.lat, where.lon)), "recent", today);
  await store(r.id, recent);
  check(await supabase.from("restaurants").update({ last_weather_on: today }).eq("id", r.id));
  return { stored: recent.length, backfilled };
}

// RUN WEATHER: do it now and say what's stored.
export async function weatherReport(r: WeatherRestaurant, now: Date) {
  const result = await runWeather(r, now, { force: true });
  if ("skipped" in result) return `🌦️ No weather stored: ${result.skipped}. Add the restaurant's address (with postcode) in settings.`;
  const supabase = getSupabase();
  const [{ count }, yesterday] = await Promise.all([
    supabase.from("weather_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
    supabase.from("weather_days").select("*").eq("restaurant_id", r.id).eq("day", addDays(londonYmd(now), -1)).maybeSingle<WeatherRow>(),
  ]);
  const y = check(yesterday);
  const first = check(
    await supabase.from("weather_days").select("day").eq("restaurant_id", r.id).order("day").limit(1).maybeSingle<{ day: string }>(),
  );
  const lines = [
    `🌦️ *Weather stored* for ${r.name}: ${count ?? 0} days${first ? `, back to ${dayLabel(first.day, 0)}` : ""}.${result.backfilled ? ` (Just fetched the last 12 months: ${result.backfilled} days.)` : ""}`,
  ];
  if (y) lines.push(`Yesterday: ${y.temp_max ?? "?"}°C max, ${y.rain_mm ?? 0}mm rain${y.conditions ? ` (${y.conditions.toLowerCase()})` : ""}.`);
  return lines.join("\n");
}
