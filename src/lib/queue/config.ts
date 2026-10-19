// Settings for the job queue (supabase/027_job_queue.sql). Plain values, no
// imports, so tests and the simulation read the same numbers.
//
// Per-type limits (how many run at once, attempts, lock time) live in the
// job_types table, so they can be changed in Supabase without a redeploy.

// Job types the app's own workers run. A new type: add a row to job_types
// (a numbered SQL file) and register its handler in lib/queue/handlers.ts.
export const JOB_TYPES = [
  "owner_message",
  "morning",
  "agent",
  "review_check",
  "gm_alerts",
  "feedback",
  "release_sends",
  "weather",
  "health_check",
  "cleanup",
  // The outside data feeds (lib/feeds, supabase/041_outside_feeds.sql)
  "feed_weather",
  "feed_calendar",
  "feed_prayer",
  "feed_football",
  "feed_events",
  "feed_disruption",
  "feed_terms_check",
  "feed_backfill",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

// Models the analytics service (analytics/service, Python) runs every night, one
// job per model per active restaurant, each due at its own UK time (`at`):
//   05:35  forecast_baseline and forecast_daily: after the 05:00 trading-day
//          cut-off, so yesterday's trading counts (the re-fit and forecast);
//   07:00  forecast_refresh: days 0 to 2 again with the latest weather forecast
//          and calendar, no re-fit.
// The hourly run in the hour of `at` (05:05, 07:05) queues them to start at that
// time; the 09:00 daily backup queues every one (same key, so never twice) if
// its run was missed, to start at once. Each needs its row in job_types with
// runner 'external' (supabase/039_analytics_jobs.sql, 040_forecast_model.sql).
// Only queued while ANALYTICS_JOBS is on. The Python side issues its forecasts
// on the same clock (analytics/service/src/dinerai_analytics/cutoff.py).
export type NightlyModel = { type: string; at: { hour: number; minute: number } };
export const NIGHTLY_MODELS_AT = { hour: 5, minute: 35 } as const; // UK time the nightly re-fits are due
export const NIGHTLY_MODELS: readonly NightlyModel[] = [
  { type: "forecast_baseline", at: NIGHTLY_MODELS_AT },
  { type: "forecast_daily", at: NIGHTLY_MODELS_AT },
  { type: "forecast_refresh", at: { hour: 7, minute: 0 } },
];

// Lower runs first.
export const PRIORITY = {
  owner: 0, // owner replies
  morningEarly: 10, // morning steps queued before 9:30 UK time
  normal: 50, // everything else
} as const;

// The daily clean-up: finished jobs are removed after this many days, dead ones after this many.
export const RETENTION = { doneDays: 14, deadDays: 90 } as const;

// One worker call (a Vercel function with maxDuration 300 seconds) runs this
// many jobs side by side, and stops taking new ones after CLAIM_FOR_MS so a job
// it starts can still finish before the function is stopped.
export const WORKER = { lanes: 3, claimForMs: 150_000 } as const;

// Health: alert the builder when this many jobs are due at once, or the oldest
// due job has waited this long.
export const BACKLOG_ALERT = { due: 100, oldestMinutes: 15 } as const;

// Every morning brief should be out (or deliberately held for WhatsApp's
// 24-hour rule) by 9:30 UK time.
export const BRIEF_DUE = { hour: 9, minute: 30 } as const;
