// Weather from Open-Meteo: the addresses to call and turning the answers into
// rows. Pure (no database, no network), unit-tested against saved real answers
// (tests/fixtures/feeds/openmeteo_*.json).
//
// One weather model everywhere, ECMWF IFS 0.25 (forecasts, live and archived)
// and ERA5 (actuals), the same as the synthetic data the forecast model was
// built on, so its back-test errors match what it sees live. The model's grid
// is 0.25 degrees: every restaurant in one grid cell gets the same weather, so
// a cell is fetched once ("51.50,0.00", its centre).
//
// Daily actuals are worked out from the hours (London days), as the generator
// does (analytics/generator/synth/outside/weather.py daily()).
import { conditionsFor } from "@/lib/sales/weather-data";

export const FORECAST_MODEL = "ecmwf_ifs025";
export const PROVIDER = {
  forecast: `open-meteo (${FORECAST_MODEL})`,
  previous: `open-meteo previous runs (${FORECAST_MODEL})`,
  archive: "open-meteo archive (ERA5)",
} as const;
// The forecast leads (days before) kept from the archived runs, as the generator: hourly for 1 and 2, daily for 1 to 7.
export const PREVIOUS_LEADS = [1, 2, 3, 4, 5, 6, 7] as const;
const HOURLY_LEADS = 2;

const ACTUAL_VARS = "temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,sunshine_duration";
const FORECAST_HOURLY = "temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,sunshine_duration";
const FORECAST_DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,sunshine_duration";
const PREVIOUS_VARS = ["temperature_2m", "precipitation", "sunshine_duration"] as const;

// The grid cell a point is in, and the cell's centre.
export function cellOf(lat: number, lon: number) {
  const snap = (v: number) => (Math.round(v * 4) / 4).toFixed(2);
  return `${snap(lat)},${snap(lon)}`;
}
export function cellCentre(cell: string) {
  const [lat, lon] = cell.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Not a weather cell: ${cell}`);
  return { lat, lon };
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const at = (p: { lat: number; lon: number }) => ({ latitude: String(p.lat), longitude: String(p.lon) });

// The forecast as issued now (days 0 to 7, hour by hour and by day), plus the
// last 7 days hour by hour (actuals the archive, about 5 days behind, doesn't have yet).
export function forecastUrl(p: { lat: number; lon: number }) {
  return `https://api.open-meteo.com/v1/forecast?${q({
    ...at(p), hourly: FORECAST_HOURLY, daily: FORECAST_DAILY, past_days: "7", forecast_days: "8",
    models: FORECAST_MODEL, timezone: "Europe/London", timeformat: "unixtime",
  })}`;
}

// Open-Meteo applies one fixed offset to a whole answer (the time zone's offset
// when asked), so near a clock change its "London" day boundaries are an hour
// out. Hours are asked in UTC with a day either side, and London days are made
// from the real instants (dayActuals, previousRunRows) instead.
const padded = (from: string, to: string) => ({ start_date: shiftDay(from, -1), end_date: shiftDay(to, 1), timezone: "UTC", timeformat: "unixtime" });

// Hourly actuals covering two London days (inclusive).
export function archiveUrl(p: { lat: number; lon: number }, from: string, to: string) {
  return `https://archive-api.open-meteo.com/v1/archive?${q({ ...at(p), ...padded(from, to), hourly: ACTUAL_VARS })}`;
}

// Forecasts as they were issued 1 to 7 days before, covering two London days.
export function previousRunsUrl(p: { lat: number; lon: number }, from: string, to: string) {
  const hourly = PREVIOUS_VARS.flatMap((v) => PREVIOUS_LEADS.map((n) => `${v}_previous_day${n}`)).join(",");
  return `https://previous-runs-api.open-meteo.com/v1/forecast?${q({ ...at(p), ...padded(from, to), hourly, models: FORECAST_MODEL })}`;
}

// When the weather model last ran (Open-Meteo has no issue time of its own).
export const MODEL_META_URL = `https://api.open-meteo.com/data/${FORECAST_MODEL}/static/meta.json`;
export function modelRunAt(meta: { last_run_initialisation_time?: number } | null | undefined) {
  const t = meta?.last_run_initialisation_time;
  return typeof t === "number" && t > 0 ? new Date(t * 1000).toISOString() : null;
}

type Series = { time?: number[] } & Record<string, (number | null)[] | number[] | undefined>;
export type OpenMeteoAnswer = { latitude?: number; longitude?: number; utc_offset_seconds?: number; hourly?: Series; daily?: Series };

export type HourActual = {
  hour_start: string;
  temp: number | null;
  rain_mm: number | null;
  weather_code: number | null;
  cloud_pct: number | null;
  wind_kmh: number | null;
  sunshine_min: number | null;
};
export type DayActual = {
  day: string;
  temp_max: number | null;
  temp_min: number | null;
  temp_mean: number | null;
  rain_mm: number | null;
  weather_code: number | null;
  conditions: string | null;
  sunshine_hours: number | null;
};
export type ForecastRow = {
  issued_at: string;
  target_day?: string;
  hour_start?: string;
  temp_max?: number | null;
  temp_min?: number | null;
  temp?: number | null;
  rain_mm: number | null;
  rain_chance?: number | null;
  weather_code?: number | null;
  sunshine_min?: number | null;
  sunshine_hours?: number | null;
  provider: string;
  model_run_at?: string | null;
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const num = (s: Series | undefined, key: string, i: number) => {
  const v = (s?.[key] as (number | null)[] | undefined)?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const round = (v: number | null, f: (n: number) => number = r1) => (v === null ? null : f(v));

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export const londonDayOf = (ms: number) => dayFormat.format(new Date(ms));

// The London midnight that starts a day, as an instant.
export function londonMidnight(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // London is UTC or UTC+1: midnight is at 00:00 or 23:00 UTC the day before.
  return londonDayOf(guess - 3_600_000) === day ? new Date(guess - 3_600_000) : new Date(guess);
}

// Hourly actuals from an archive or forecast answer (hours with no temperature yet are left out).
export function hourActuals(json: OpenMeteoAnswer, before?: Date): HourActual[] {
  const h = json.hourly;
  const out: HourActual[] = [];
  (h?.time ?? []).forEach((t, i) => {
    if (before && t * 1000 >= before.getTime()) return;
    const temp = num(h, "temperature_2m", i);
    if (temp === null) return;
    const sun = num(h, "sunshine_duration", i);
    out.push({
      hour_start: new Date(t * 1000).toISOString(),
      temp: r1(temp),
      rain_mm: round(num(h, "precipitation", i)),
      weather_code: round(num(h, "weather_code", i), Math.round),
      cloud_pct: round(num(h, "cloud_cover", i), Math.round),
      wind_kmh: round(num(h, "wind_speed_10m", i)),
      sunshine_min: sun === null ? null : Math.min(60, Math.max(0, Math.round(sun / 60))),
    });
  });
  return out;
}

// Each London day with all its hours (23 or 25 on a clock change): max, min,
// mean, rain, the worst weather code, sunshine hours.
export function dayActuals(hours: HourActual[]): DayActual[] {
  const byDay = new Map<string, HourActual[]>();
  for (const h of hours) {
    const d = londonDayOf(new Date(h.hour_start).getTime());
    byDay.set(d, [...(byDay.get(d) ?? []), h]);
  }
  const out: DayActual[] = [];
  for (const [day, hs] of [...byDay.entries()].sort()) {
    const expected = (londonMidnight(addDay(day)).getTime() - londonMidnight(day).getTime()) / 3_600_000;
    if (hs.length < expected) continue;
    const temps = hs.map((h) => h.temp).filter((v): v is number => v !== null);
    const codes = hs.map((h) => h.weather_code).filter((v): v is number => v !== null);
    const rain = hs.map((h) => h.rain_mm).filter((v): v is number => v !== null);
    const sun = hs.map((h) => h.sunshine_min).filter((v): v is number => v !== null);
    const code = codes.length ? Math.max(...codes) : null;
    out.push({
      day,
      temp_max: temps.length ? Math.max(...temps) : null,
      temp_min: temps.length ? Math.min(...temps) : null,
      temp_mean: temps.length ? r1(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
      rain_mm: rain.length ? r1(rain.reduce((a, b) => a + b, 0)) : null,
      weather_code: code,
      conditions: code === null ? null : conditionsFor(code),
      sunshine_hours: sun.length === hs.length ? r1(sun.reduce((a, b) => a + b, 0) / 60) : null,
    });
  }
  return out;
}

function shiftDay(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const addDay = (day: string) => shiftDay(day, 1);

// The forecast as issued now: days 0 to 7 (London days) and the hours from this
// hour on. Hours already past are actuals (hourActuals with `before`).
export function forecastRows(json: OpenMeteoAnswer, issuedAt: Date, modelRun: string | null): { days: ForecastRow[]; hours: ForecastRow[] } {
  const issued_at = issuedAt.toISOString();
  const today = londonDayOf(issuedAt.getTime());
  const last = (() => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  })();
  const d = json.daily;
  const days: ForecastRow[] = [];
  // A daily time is the day's midnight at the answer's one fixed offset (see padded above).
  const offset = json.utc_offset_seconds ?? 0;
  (d?.time ?? []).forEach((t, i) => {
    const target_day = new Date((t + offset) * 1000).toISOString().slice(0, 10);
    if (target_day < today || target_day > last) return;
    const sun = num(d, "sunshine_duration", i);
    const row: ForecastRow = {
      issued_at,
      target_day,
      temp_max: round(num(d, "temperature_2m_max", i)),
      temp_min: round(num(d, "temperature_2m_min", i)),
      rain_mm: round(num(d, "precipitation_sum", i)),
      rain_chance: round(num(d, "precipitation_probability_max", i), Math.round),
      weather_code: round(num(d, "weather_code", i), Math.round),
      sunshine_hours: sun === null ? null : r1(Math.min(24, sun / 3600)),
      provider: PROVIDER.forecast,
      model_run_at: modelRun,
    };
    if (row.temp_max !== null || row.rain_mm !== null) days.push(row);
  });
  const hourStart = Math.floor(issuedAt.getTime() / 3_600_000) * 3_600_000;
  const h = json.hourly;
  const hours: ForecastRow[] = [];
  (h?.time ?? []).forEach((t, i) => {
    if (t * 1000 < hourStart || londonDayOf(t * 1000) > last) return;
    const temp = num(h, "temperature_2m", i);
    if (temp === null) return;
    const sun = num(h, "sunshine_duration", i);
    hours.push({
      issued_at,
      hour_start: new Date(t * 1000).toISOString(),
      temp: r1(temp),
      rain_mm: round(num(h, "precipitation", i)),
      rain_chance: round(num(h, "precipitation_probability", i), Math.round),
      weather_code: round(num(h, "weather_code", i), Math.round),
      sunshine_min: sun === null ? null : Math.min(60, Math.max(0, Math.round(sun / 60))),
      provider: PROVIDER.forecast,
      model_run_at: modelRun,
    });
  });
  return { days, hours };
}

// Archived forecasts (Open-Meteo Previous Runs), the generator's way: the hour
// as forecast N days before is issued N days before the hour (N = 1, 2); a
// day's forecast N days ahead is issued at the London midnight starting the
// day, minus N days, from that lead's hours (23 or more of them).
export function previousRunRows(json: OpenMeteoAnswer): { days: ForecastRow[]; hours: ForecastRow[]; firstDay: string | null } {
  const h = json.hourly;
  const times = h?.time ?? [];
  const hours: ForecastRow[] = [];
  const days: ForecastRow[] = [];
  let firstDay: string | null = null;
  for (const n of PREVIOUS_LEADS) {
    const byDay = new Map<string, { temp: number; rain: number | null; sun: number | null }[]>();
    times.forEach((t, i) => {
      const temp = num(h, `temperature_2m_previous_day${n}`, i);
      if (temp === null) return;
      const rain = num(h, `precipitation_previous_day${n}`, i);
      const sun = num(h, `sunshine_duration_previous_day${n}`, i);
      const day = londonDayOf(t * 1000);
      if (!firstDay || day < firstDay) firstDay = day;
      byDay.set(day, [...(byDay.get(day) ?? []), { temp, rain, sun }]);
      if (n <= HOURLY_LEADS) {
        hours.push({
          issued_at: new Date(t * 1000 - n * 86_400_000).toISOString(),
          hour_start: new Date(t * 1000).toISOString(),
          temp: r1(temp),
          rain_mm: round(rain),
          sunshine_min: sun === null ? null : Math.min(60, Math.max(0, Math.round(sun / 60))),
          provider: PROVIDER.previous,
        });
      }
    });
    for (const [day, hs] of byDay) {
      if (hs.length < 23) continue;
      const temps = hs.map((x) => x.temp);
      const rain = hs.map((x) => x.rain).filter((v): v is number => v !== null);
      const sun = hs.map((x) => x.sun).filter((v): v is number => v !== null);
      days.push({
        issued_at: new Date(londonMidnight(day).getTime() - n * 86_400_000).toISOString(),
        target_day: day,
        temp_max: r1(Math.max(...temps)),
        temp_min: r1(Math.min(...temps)),
        rain_mm: rain.length >= 20 ? r1(rain.reduce((a, b) => a + b, 0)) : null,
        sunshine_hours: sun.length >= 20 ? r1(Math.min(24, sun.reduce((a, b) => a + b, 0) / 3600)) : null,
        provider: PROVIDER.previous,
      });
    }
  }
  return { days, hours, firstDay };
}
