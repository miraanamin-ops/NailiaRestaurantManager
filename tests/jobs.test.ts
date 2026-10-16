// Scheduled jobs: the once-a-day guard, and spotting failed, stuck or late jobs.
import { describe, expect, test } from "vitest";
import { backlogProblem, briefIsLate, hourlyIsLate, runFailed, stuckRuns, unalertedFailures } from "@/lib/job-health";
import { morningGate } from "@/lib/morning-gate";

const at = (iso: string) => new Date(iso);
const fresh = { last_brief_on: null, morning_failed_on: null, morning_failures: 0 };

describe("the morning job runs once a day, from 9am UK", () => {
  test("not before 9am (UK time, summer and winter)", () => {
    expect(morningGate(fresh, at("2026-10-09T07:59:00Z"), 3)).toBe("before 9am"); // 08:59 BST
    expect(morningGate(fresh, at("2026-10-09T08:05:00Z"), 3)).toBeNull(); // 09:05 BST
    expect(morningGate(fresh, at("2026-12-01T08:30:00Z"), 3)).toBe("before 9am"); // 08:30 GMT
  });
  test("only once per day", () => {
    expect(morningGate({ ...fresh, last_brief_on: "2026-10-09" }, at("2026-10-09T10:05:00Z"), 3)).toBe("already done today");
    expect(morningGate({ ...fresh, last_brief_on: "2026-10-08" }, at("2026-10-09T10:05:00Z"), 3)).toBeNull();
  });
  test("retries after a failure, but gives up after 3 tries that day", () => {
    expect(morningGate({ ...fresh, morning_failed_on: "2026-10-09", morning_failures: 2 }, at("2026-10-09T11:05:00Z"), 3)).toBeNull();
    expect(morningGate({ ...fresh, morning_failed_on: "2026-10-09", morning_failures: 3 }, at("2026-10-09T12:05:00Z"), 3)).toMatch(/gave up/);
    // yesterday's failures don't count today
    expect(morningGate({ ...fresh, morning_failed_on: "2026-10-08", morning_failures: 3 }, at("2026-10-09T08:05:00Z"), 3)).toBeNull();
  });
});

describe("spotting jobs that failed, got stuck or didn't run", () => {
  const now = at("2026-10-09T12:00:00Z");
  test("a run still 'running' after 15 minutes is stuck", () => {
    const runs = [
      { job: "hourly", status: "running" as const, started_at: "2026-10-09T11:40:00Z" },
      { job: "hourly", status: "running" as const, started_at: "2026-10-09T11:55:00Z" },
      { job: "daily", status: "ok" as const, started_at: "2026-10-09T09:00:00Z" },
    ];
    expect(stuckRuns(runs, now).map((r) => r.started_at)).toEqual(["2026-10-09T11:40:00Z"]);
  });
  test("the hourly job is late after two missed runs", () => {
    expect(hourlyIsLate("2026-10-09T11:05:00Z", now, "2026-10-08T12:00:00Z")).toBe(false);
    expect(hourlyIsLate("2026-10-09T09:05:00Z", now, "2026-10-08T12:00:00Z")).toBe(true);
    // never ran, and runs have been recorded for hours: late
    expect(hourlyIsLate(null, now, "2026-10-09T08:00:00Z")).toBe(true);
    // never ran, but recording only just started (fresh deploy): not late yet
    expect(hourlyIsLate(null, now, "2026-10-09T11:59:00Z")).toBe(false);
    expect(hourlyIsLate(null, now, null)).toBe(false);
  });
  test("the brief is late if it hasn't been sent (or held for the 24-hour rule) by 9:30 UK", () => {
    const base = { today: "2026-10-09", lastBriefOn: null };
    expect(briefIsLate({ ...base, londonMinutes: 9 * 60 + 29 })).toBe(false);
    expect(briefIsLate({ ...base, londonMinutes: 9 * 60 + 30 })).toBe(true);
    // Sent, or held for WhatsApp's 24-hour window: both mark the day done, so not late.
    expect(briefIsLate({ ...base, londonMinutes: 9 * 60 + 31, lastBriefOn: "2026-10-09" })).toBe(false);
    // Yesterday's brief doesn't count; a failed or dead brief step is late too.
    expect(briefIsLate({ ...base, londonMinutes: 13 * 60, lastBriefOn: "2026-10-08" })).toBe(true);
  });
  test("the queue is backing up: too many jobs due, or one waiting too long", () => {
    const now = at("2026-10-09T09:20:00Z");
    expect(backlogProblem([{ due: 40, oldest_due: "2026-10-09T09:15:00Z" }], now)).toBeNull();
    expect(backlogProblem([{ due: 60, oldest_due: "2026-10-09T09:15:00Z" }, { due: 40, oldest_due: "2026-10-09T09:12:00Z" }], now)).toMatch(/100 jobs are due, the oldest waiting 8 minutes/);
    expect(backlogProblem([{ due: 2, oldest_due: "2026-10-09T09:01:00Z" }], now)).toMatch(/waited 19 minutes/);
    expect(backlogProblem([], now)).toBeNull();
  });
  test("a run's real outcome, and which failures still need an alert", () => {
    const ok = [{ restaurant: "a", reviews: { found: 1, failed: 0 }, morning: { skipped: "already done today" } }];
    const reviewFail = [{ restaurant: "a", reviews: { found: 2, failed: 1 } }];
    const morningAlerted = [{ restaurant: "a", morning: { error: "boom", failures: 1, alerted: true } }];
    expect(runFailed(ok)).toBe(false);
    expect(runFailed(reviewFail)).toBe(true);
    expect(runFailed(morningAlerted)).toBe(true); // still recorded as failed...
    expect(unalertedFailures(morningAlerted)).toBe(false); // ...but the builder already knows
    expect(unalertedFailures(reviewFail)).toBe(true);
  });
});
