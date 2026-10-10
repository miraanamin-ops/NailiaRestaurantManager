// Weather from Open-Meteo (free, no key): the addresses to call and turning
// the answer into rows. No imports beyond ./format, so it's unit-tested.
import { addDays } from "./format";

const DAILY = "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code";

export type WeatherRow = {
  day: string;
  temp_max: number | null;
  temp_min: number | null;
  temp_mean: number | null;
  rain_mm: number | null;
  weather_code: number | null;
  conditions: string | null;
  source: "archive" | "recent" | "forecast";
};

// The last 12 months, once (the archive runs about 5 days behind).
export function archiveUrl(lat: number, lon: number, today: string) {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: addDays(today, -365),
    end_date: addDays(today, -8),
    daily: DAILY,
    timezone: "Europe/London",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${q}`;
}

// The last 7 days and today (today is still a forecast; it's replaced tomorrow).
export function recentUrl(lat: number, lon: number) {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: DAILY, past_days: "7", forecast_days: "1", timezone: "Europe/London" });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Daily = { time?: string[] } & Record<string, (number | null)[] | string[] | undefined>;

export function weatherRows(json: { daily?: Daily }, kind: "archive" | "recent", today: string): WeatherRow[] {
  const d = json.daily;
  if (!d?.time) return [];
  const num = (key: string, i: number) => {
    const v = (d[key] as (number | null)[] | undefined)?.[i];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };
  return d.time
    .map((day, i) => {
      const code = num("weather_code", i);
      return {
        day,
        temp_max: num("temperature_2m_max", i),
        temp_min: num("temperature_2m_min", i),
        temp_mean: num("temperature_2m_mean", i),
        rain_mm: num("precipitation_sum", i),
        weather_code: code,
        conditions: code === null ? null : conditionsFor(code),
        source: (kind === "archive" ? "archive" : day >= today ? "forecast" : "recent") as WeatherRow["source"],
      };
    })
    .filter((r) => r.temp_max !== null || r.rain_mm !== null);
}

// WMO weather codes in plain words.
export function conditionsFor(code: number) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 55) return "Drizzle";
  if (code <= 57) return "Freezing drizzle";
  if (code === 61) return "Light rain";
  if (code === 63) return "Rain";
  if (code <= 67) return "Heavy rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

// A rainy day for the sales patterns: at least 1mm of rain.
export const RAINY_MM = 1;

// The UK postcode at the end of an address ("214 Whitechapel Road, London E1 1BJ" -> "E1 1BJ").
export function postcodeOf(address: string | null) {
  const m = (address ?? "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? `${m[1]} ${m[2]}` : null;
}

// The town, for when there's no postcode: the last part of the address without numbers.
export function townOf(address: string | null) {
  const parts = (address ?? "")
    .split(",")
    .map((p) =>
      p
        .replace(/\b(UK|United Kingdom)\b/i, "")
        .split(/\s+/)
        .filter((w) => !/\d/.test(w))
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
  return parts.at(-1) ?? null;
}
