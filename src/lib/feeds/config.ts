// The outside data feeds: what each one is, when it runs, what it needs.
// Plain values and pure rules, no imports beyond the clock, so the planning is
// unit-tested (tests/feeds-plan.test.ts).
//
// Times (UK):
//   04:30  every daily feed, so they finish before the 05:35 forecast re-fit
//   06:45  the weather forecast again, so the 07:00 forecast refresh has the latest
// The hourly run in that hour (04:05, 06:05) queues them to start at that time;
// the 09:00 daily backup queues any that were missed (same key, so never twice).
import { londonParts, londonTime, londonYmd } from "@/lib/clock";

export type Env = Record<string, string | undefined>;

export const FEED_NAMES = ["weather", "calendar", "prayer", "football", "events", "disruption", "school_terms", "backfill"] as const;
export type FeedName = (typeof FEED_NAMES)[number];

export type FeedDef = {
  name: FeedName;
  jobType: string;
  label: string;
  // shared: one job for everyone; restaurant: one per active restaurant; cell: one per weather cell.
  per: "shared" | "restaurant" | "cell" | "on demand";
  // The API key it needs (missing = skipped and reported, never a crash).
  keyEnv?: string;
  // The key helps but isn't needed (TfL works without one, more slowly).
  keyOptional?: boolean;
  source: string;
};

export const FEEDS: Record<FeedName, FeedDef> = {
  weather: { name: "weather", jobType: "feed_weather", label: "Weather", per: "cell", source: "Open-Meteo (ECMWF IFS 0.25)" },
  calendar: { name: "calendar", jobType: "feed_calendar", label: "Calendar", per: "shared", source: "gov.uk, Umm al-Qura, calculated dates" },
  prayer: { name: "prayer", jobType: "feed_prayer", label: "Prayer times", per: "restaurant", source: "Calculated (adhan), or a mosque timetable" },
  football: { name: "football", jobType: "feed_football", label: "Football", per: "shared", keyEnv: "FOOTBALL_DATA_API_KEY", source: "football-data.org" },
  events: { name: "events", jobType: "feed_events", label: "Local events", per: "restaurant", keyEnv: "TICKETMASTER_API_KEY", source: "Ticketmaster Discovery" },
  disruption: { name: "disruption", jobType: "feed_disruption", label: "Disruption", per: "shared", keyEnv: "TFL_API_KEY", keyOptional: true, source: "TfL Unified API" },
  school_terms: { name: "school_terms", jobType: "feed_terms_check", label: "School dates", per: "shared", source: "Council term dates (builder)" },
  backfill: { name: "backfill", jobType: "feed_backfill", label: "Backfill", per: "on demand", source: "All of the above, for the sales history" },
};

export const FEED_JOB_TYPES = Object.values(FEEDS).map((f) => f.jobType);
export const feedForJobType = (type: string) => Object.values(FEEDS).find((f) => f.jobType === type) ?? null;

// The key a feed needs, if it's missing: the feed is skipped with this reason.
export function missingKey(feed: FeedName, env: Env): string | null {
  const def = FEEDS[feed];
  if (!def.keyEnv || def.keyOptional) return null;
  return env[def.keyEnv]?.trim() ? null : `no ${def.keyEnv} set`;
}

export const FEED_TIMES = {
  daily: { hour: 4, minute: 30 },
  weatherRefresh: { hour: 6, minute: 45 },
} as const;

// How far ahead each feed looks.
export const HORIZON = {
  forecastDays: 8, // weather forecast: days 0 to 7
  prayerDays: 60,
  fixturesDays: 60,
  eventsDays: 60,
  disruptionDays: 60,
  calendarYears: 2, // religious and cultural dates, paydays, clock changes
  termWarningMonths: 4, // alert the builder when a council's dates run out sooner
} as const;

export const EVENTS_RADIUS_KM = 5;

// One planned feed job (the dispatcher queues it).
export type PlannedFeedJob = { type: string; key: string; restaurantId: string | null; runAt?: Date; payload: Record<string, unknown> };

export type FeedRestaurant = { id: string; weatherCell: string | null };

// The feed jobs the hourly run (or its 09:00 backup) queues now. Weather: one
// job per cell (restaurants not located yet get one each, keyed by restaurant,
// and are given their cell by it).
export function plannedFeedJobs(job: "hourly" | "daily", now: Date, restaurants: FeedRestaurant[], enabled: Record<string, boolean>): PlannedFeedJob[] {
  const out: PlannedFeedJob[] = [];
  const day = londonYmd(now);
  const p = londonParts(now);
  const slot = (at: { hour: number; minute: number }) => {
    if (job !== "daily" && p.hour !== at.hour) return null;
    const due = londonTime(p.year, p.month, p.day, at.hour, at.minute);
    return { runAt: due > now ? due : undefined };
  };
  const on = (f: FeedName) => enabled[f] !== false;

  const daily = slot(FEED_TIMES.daily);
  const refresh = job === "hourly" ? slot(FEED_TIMES.weatherRefresh) : null;

  const weather = (mode: "daily" | "refresh", runAt: Date | undefined) => {
    if (!on("weather")) return;
    const cells = new Map<string, string[]>();
    for (const r of restaurants) {
      const key = r.weatherCell ?? `restaurant:${r.id}`;
      cells.set(key, [...(cells.get(key) ?? []), r.id]);
    }
    for (const [cell, ids] of [...cells.entries()].sort()) {
      out.push({ type: "feed_weather", key: `feed_weather:${cell}:${day}:${mode}`, restaurantId: cell.startsWith("restaurant:") ? ids[0] : null, runAt, payload: { mode, cell, restaurants: ids, day } });
    }
  };

  if (daily) {
    weather("daily", daily.runAt);
    for (const f of ["calendar", "football", "disruption", "school_terms"] as const) {
      if (on(f)) out.push({ type: FEEDS[f].jobType, key: `${FEEDS[f].jobType}:${day}`, restaurantId: null, runAt: daily.runAt, payload: { day } });
    }
    for (const f of ["prayer", "events"] as const) {
      if (!on(f)) continue;
      for (const r of restaurants) out.push({ type: FEEDS[f].jobType, key: `${FEEDS[f].jobType}:${r.id}:${day}`, restaurantId: r.id, runAt: daily.runAt, payload: { day } });
    }
  }
  if (refresh) weather("refresh", refresh.runAt);
  return out;
}

// What a new address clears, so the feeds find the place again (lib/feeds/location.ts).
export const LOCATION_RESET = { latitude: null, longitude: null, weather_cell: null, council_code: null, council_name: null } as const;

// A POS import with sales older than this many days brings history the
// backfill hasn't covered yet (it covers at least a year, so a recent file doesn't).
export const HISTORIC_IMPORT_DAYS = 30;
export function historicImport(firstDay: string, today: string) {
  const [y, m, d] = today.split("-").map(Number);
  return firstDay < new Date(Date.UTC(y, m - 1, d - HISTORIC_IMPORT_DAYS)).toISOString().slice(0, 10);
}

// When each feed next runs (for /log): the next 04:30 (weather: 04:30 or 06:45).
export function nextRunAt(feed: FeedName, now: Date): Date | null {
  if (feed === "backfill") return null;
  const p = londonParts(now);
  const times = feed === "weather" ? [FEED_TIMES.daily, FEED_TIMES.weatherRefresh] : [FEED_TIMES.daily];
  for (let add = 0; add < 2; add++) {
    for (const t of times) {
      const at = londonTime(p.year, p.month, p.day + add, t.hour, t.minute);
      if (at > now) return at;
    }
  }
  return null;
}

// A feed is stale when its last success is older than its fresh_hours (a
// feed switched off, or one that has never been expected to run, isn't).
export function feedProblem(
  s: { feed: string; enabled: boolean; fresh_hours: number | null; last_success_at: string | null; last_outcome: string | null; last_error: string | null; last_run_at: string | null },
  now: Date,
): string | null {
  if (!s.enabled || !s.fresh_hours) return null;
  // Skipped on purpose (no API key yet): shown on /log, not an alert.
  if (s.last_outcome === "skipped") return null;
  const since = s.last_success_at ? (now.getTime() - new Date(s.last_success_at).getTime()) / 3_600_000 : null;
  if (s.last_outcome === "failed" && s.last_error) {
    return `the ${s.feed} feed is failing: ${s.last_error.slice(0, 200)}`;
  }
  if (since === null) return s.last_run_at ? `the ${s.feed} feed has never succeeded` : null;
  if (since > s.fresh_hours) return `the ${s.feed} feed's data is ${Math.round(since)} hours old (expected within ${s.fresh_hours})`;
  return null;
}
