import { BACKLOG_ALERT, BRIEF_DUE } from "./queue/config";
// Is a scheduled job late or stuck? Plain code (its only import is plain settings), so every
// case is unit-tested (tests/jobs.test.ts). lib/job-runs.ts acts on the answers.

export type RunRow = { job: string; status: "running" | "ok" | "failed"; started_at: string };

// A run still "running" after this long crashed or timed out.
export const STUCK_AFTER_MINUTES = 15;
// The hourly job runs at 5 past every hour; two missed in a row means it's stopped.
export const HOURLY_LATE_AFTER_MINUTES = 130;
// The morning brief is due by 9:30 UK (lib/queue/config.ts BRIEF_DUE).
export const BRIEF_DUE_MINUTES = BRIEF_DUE.hour * 60 + BRIEF_DUE.minute;

export function stuckRuns<T extends RunRow>(runs: T[], now: Date) {
  return runs.filter((r) => r.status === "running" && now.getTime() - new Date(r.started_at).getTime() > STUCK_AFTER_MINUTES * 60_000);
}

// The latest hourly run started too long ago. trackingSince: the earliest run
// recorded at all, so a freshly set-up system (no runs yet) isn't reported as late.
export function hourlyIsLate(lastHourlyStart: string | null, now: Date, trackingSince: string | null) {
  const late = (iso: string) => now.getTime() - new Date(iso).getTime() > HOURLY_LATE_AFTER_MINUTES * 60_000;
  if (lastHourlyStart) return late(lastHourlyStart);
  return trackingSince ? late(trackingSince) : false;
}

// From 9:30 UK the brief is late unless it has been sent today, or deliberately
// held for WhatsApp's 24-hour rule (the brief step marks that day done too: it
// goes with the owner's next message). A brief whose step failed or died is late.
export function briefIsLate(input: { londonMinutes: number; today: string; lastBriefOn: string | null }) {
  if (input.londonMinutes < BRIEF_DUE_MINUTES) return false;
  return input.lastBriefOn !== input.today;
}

// Is the queue backing up? Too many jobs due at once, or one waiting too long.
export function backlogProblem(stats: { due: number; oldest_due: string | null }[], now: Date): string | null {
  const due = stats.reduce((n, s) => n + s.due, 0);
  const oldest = stats.map((s) => s.oldest_due).filter((x): x is string => Boolean(x)).sort()[0];
  const waited = oldest ? Math.floor((now.getTime() - new Date(oldest).getTime()) / 60_000) : 0;
  if (due >= BACKLOG_ALERT.due) return `${due} jobs are due${oldest ? `, the oldest waiting ${waited} minutes` : ""}`;
  if (waited >= BACKLOG_ALERT.oldestMinutes) return `a job has waited ${waited} minutes (${due} due)`;
  return null;
}

type Part = Record<string, unknown>;
const partsOf = (s: Record<string, unknown>) => [s.morning, s.reviews, s.dispatch].filter((p): p is Part => Boolean(p) && typeof p === "object");
const isFailure = (p: Part) => Boolean(p.error) || (typeof p.failed === "number" && p.failed > 0);

// A job's outcome from its per-restaurant summary: any error means it failed.
export function runFailed(summary: Record<string, unknown>[]) {
  return summary.some((s) => partsOf(s).some(isFailure));
}

// Failures the builder hasn't been told about yet (the morning job alerts for its own).
export function unalertedFailures(summary: Record<string, unknown>[]) {
  return summary.some((s) => partsOf(s).some((p) => isFailure(p) && !p.alerted));
}
