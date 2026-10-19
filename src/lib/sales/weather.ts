import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { enqueueBackfill } from "@/lib/feeds/backfill";
import { weatherForCell } from "@/lib/feeds/jobs";
import { ensureLocated } from "@/lib/feeds/location";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { addDays, dayLabel } from "./format";
import type { WeatherRow } from "./weather-data";

// Each restaurant's weather is fetched by the weather feed (lib/feeds: 04:30
// and 06:45 UK, one call per weather cell; its history by the backfill). This
// is RUN WEATHER: the same, now, for one restaurant.

type WeatherRestaurant = Pick<Restaurant, "id" | "name" | "address"> & { latitude?: number | null; longitude?: number | null; outside_backfilled_at?: string | null };

export async function runWeather(r: WeatherRestaurant, now: Date) {
  const where = await ensureLocated(r);
  if (!where) return { skipped: "no address to find the weather for" } as const;
  const rows = await weatherForCell(where.cell, [r.id], "daily", now);
  // The history comes from the backfill (a chain of jobs), queued here if it hasn't run.
  const backfill = r.outside_backfilled_at ? null : await enqueueBackfill(r.id, "first_run", now);
  return { rows, backfillQueued: Boolean(backfill) };
}

// RUN WEATHER: do it now and say what's stored.
export async function weatherReport(r: WeatherRestaurant, now: Date) {
  const result = await runWeather(r, now);
  if ("skipped" in result) return `🌦️ No weather stored: ${result.skipped}. Add the restaurant's address (with postcode) in settings.`;
  const supabase = getSupabase();
  const [{ count }, yesterday] = await Promise.all([
    supabase.from("weather_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
    supabase.from("weather_days").select("*").eq("restaurant_id", r.id).eq("day", addDays(londonYmd(now), -1)).maybeSingle<WeatherRow & { sunshine_hours: number | null }>(),
  ]);
  const y = check(yesterday);
  const first = check(
    await supabase.from("weather_days").select("day").eq("restaurant_id", r.id).order("day").limit(1).maybeSingle<{ day: string }>(),
  );
  const lines = [
    `🌦️ *Weather stored* for ${r.name}: ${count ?? 0} days${first ? `, back to ${dayLabel(first.day, 0)}` : ""}, and the forecast for the next 8 days.${result.backfillQueued ? " (The history is being filled in now.)" : ""}`,
  ];
  if (y) lines.push(`Yesterday: ${y.temp_max ?? "?"}°C max, ${y.rain_mm ?? 0}mm rain${y.sunshine_hours != null ? `, ${y.sunshine_hours}h sunshine` : ""}${y.conditions ? ` (${y.conditions.toLowerCase()})` : ""}.`);
  return lines.join("\n");
}
