// Scheduled jobs: the once-a-day guard, and spotting failed, stuck or late jobs.
import { describe, expect, test } from "vitest";
import { briefIsLate, hourlyIsLate, runFailed, stuckRuns, unalertedFailures } from "@/lib/job-health";
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
    expect(hourlyIsLate("2026-10-09T11:05:00Z", now)).toBe(false);
    expect(hourlyIsLate("2026-10-09T09:05:00Z", now)).toBe(true);
    expect(hourlyIsLate(null, now)).toBe(true);
  });
  test("the brief is late if it's not out by 11am, unless the job already gave up (and alerted)", () => {
    const base = { today: "2026-10-09", lastBriefOn: null, failuresToday: 0, maxFailures: 3 };
    expect(briefIsLate({ ...base, londonHour: 10 })).toBe(false);
    expect(briefIsLate({ ...base, londonHour: 11 })).toBe(true);
    expect(briefIsLate({ ...base, londonHour: 11, lastBriefOn: "2026-10-09" })).toBe(false);
    expect(briefIsLate({ ...base, londonHour: 13, failuresToday: 3 })).toBe(false);
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
