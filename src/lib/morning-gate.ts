import { londonParts, londonYmd } from "@/lib/clock";

// Should the morning job run now? Plain code (no database), so the
// once-a-day guard is unit-tested (tests/jobs.test.ts). null = go ahead.
export const BRIEF_HOUR = 9;

export function morningGate(
  r: { last_brief_on: string | null; morning_failed_on: string | null; morning_failures: number },
  now: Date,
  maxFailures: number,
): string | null {
  const today = londonYmd(now);
  if (londonParts(now).hour < BRIEF_HOUR) return "before 9am";
  if (r.last_brief_on === today) return "already done today";
  const failuresToday = r.morning_failed_on === today ? r.morning_failures : 0;
  if (failuresToday >= maxFailures) return `gave up after ${maxFailures} failed tries today`;
  return null;
}
