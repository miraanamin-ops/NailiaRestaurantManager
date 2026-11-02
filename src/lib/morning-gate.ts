import { londonParts, londonYmd } from "@/lib/clock";

// Should the morning job run now? Plain code (no database), so the
// once-a-day guard is unit-tested (tests/jobs.test.ts). null = go ahead.
// Each restaurant picks its brief hour (restaurants.brief_hour, 7 to 11, set in
// setup step 12); 9am when it isn't set.
export const BRIEF_HOUR = 9;

export function briefHourOf(r: { brief_hour?: number | null }) {
  const h = Number(r.brief_hour);
  return Number.isInteger(h) && h >= 7 && h <= 11 ? h : BRIEF_HOUR;
}

export function morningGate(
  r: { last_brief_on: string | null; morning_failed_on: string | null; morning_failures: number; brief_hour?: number | null },
  now: Date,
  maxFailures: number,
): string | null {
  const today = londonYmd(now);
  const hour = briefHourOf(r);
  if (londonParts(now).hour < hour) return `before ${hour}am`;
  if (r.last_brief_on === today) return "already done today";
  const failuresToday = r.morning_failed_on === today ? r.morning_failures : 0;
  if (failuresToday >= maxFailures) return `gave up after ${maxFailures} failed tries today`;
  return null;
}
