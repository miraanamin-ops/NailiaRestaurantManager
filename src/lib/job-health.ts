// Is a scheduled job late or stuck? Plain code with no imports, so every
// case is unit-tested (tests/jobs.test.ts). lib/job-runs.ts acts on the answers.

export type RunRow = { job: string; status: "running" | "ok" | "failed"; started_at: string };

// A run still "running" after this long crashed or timed out.
export const STUCK_AFTER_MINUTES = 15;
// The hourly job runs at 5 past every hour; two missed in a row means it's stopped.
export const HOURLY_LATE_AFTER_MINUTES = 130;
// The morning brief should be out by 9:05; by 11am something is wrong.
export const BRIEF_LATE_HOUR = 11;

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

// The morning job should have sent (or deliberately held) today's brief by 11am UK.
// Not late if it has failed today: it alerts the builder itself (first failure, and giving up).
export function briefIsLate(input: { londonHour: number; today: string; lastBriefOn: string | null; failuresToday: number }) {
  if (input.londonHour < BRIEF_LATE_HOUR) return false;
  if (input.lastBriefOn === input.today) return false;
  return input.failuresToday === 0;
}

type Part = Record<string, unknown>;
const partsOf = (s: Record<string, unknown>) => [s.morning, s.reviews].filter((p): p is Part => Boolean(p) && typeof p === "object");
const isFailure = (p: Part) => Boolean(p.error) || (typeof p.failed === "number" && p.failed > 0);

// A job's outcome from its per-restaurant summary: any error means it failed.
export function runFailed(summary: Record<string, unknown>[]) {
  return summary.some((s) => partsOf(s).some(isFailure));
}

// Failures the builder hasn't been told about yet (the morning job alerts for its own).
export function unalertedFailures(summary: Record<string, unknown>[]) {
  return summary.some((s) => partsOf(s).some((p) => isFailure(p) && !p.alerted));
}
