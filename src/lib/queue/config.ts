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
] as const;
export type JobType = (typeof JOB_TYPES)[number];

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
