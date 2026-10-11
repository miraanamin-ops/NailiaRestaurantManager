// Agent tests, offline (every push): the saved checker cases are well formed,
// the gate blocks what it must, and each case's recorded checker answer is a
// valid verdict that gets the case right. No network: the live run with real
// Claude is tests/agents-live/checker.eval.ts (npm run test:agents).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applicableChecks, audienceOf } from "@/lib/agents/checker-rules";
import { AGENT_NAMES } from "@/lib/agents/definition";
import { draftProblems, verdictProblems } from "@/lib/agents/schema";
import { moneyAndRisk } from "@/lib/checks/money";
import { judge, loadCases } from "./support/checker-cases";

const cases = loadCases();

test("every agent has a tests folder", () => {
  for (const name of AGENT_NAMES) expect(statSync(join("agents", "tests", name)).isDirectory(), name).toBe(true);
});

test("the checker has 10 to 15 saved cases", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  expect(cases.length).toBeLessThanOrEqual(15);
});

describe.each(cases)("checker case $file", ({ case: c }) => {
  test("is well formed: a valid draft, sources for every reference, a clear expectation", () => {
    expect(draftProblems(c.draft)).toEqual([]);
    expect(c.sources.map((s) => s.ref)).toEqual(c.draft.sources_used);
    expect(c.expect.verdict.length).toBeGreaterThan(0);
    expect(c.name && c.source && c.maker && c.today).toBeTruthy();
  });

  if (c.expect.gate) {
    test(`the release gate blocks it (${c.expect.gate.blocked}), whatever the checker says`, () => {
      const cap = Number(c.profile.fields.discount_cap);
      const r = moneyAndRisk(
        { kind: c.draft.type, status: "approved", approved_at: "2026-10-09T10:00:00Z", sent_at: null, scheduled_for: null, content: c.text },
        { paused: false, discount_cap_percent: cap, send_window_start: "09:00:00", send_window_end: "21:00:00" },
        new Date("2026-10-09T11:00:00Z"),
        "approve",
      );
      expect(r).toMatchObject({ outcome: "blocked", reason: c.expect.gate!.blocked });
    });
  }

  test("has a recorded checker answer that is valid and gets the case right", () => {
    expect(c.recorded, "no recorded answer yet: run `npm run test:agents:record`").toBeTruthy();
    const { applicable, skipped } = applicableChecks(audienceOf(c.draft.type), false);
    expect(verdictProblems(c.recorded, { applicable, skipped, draftText: c.text })).toEqual([]);
    expect(judge(c, c.recorded!)).toEqual([]);
  });
});

// House rule: no em-dashes, anywhere. This scans the code that builds what agents
// and customers read. The /agents files themselves are skipped: checker.md shows
// an em-dash on purpose (what a minor fix removes), and so do the saved cases.
test("no em-dashes in agent, email, report and QR pack code", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
    });
  const offenders = [...files(join("src", "lib", "agents")), ...files(join("src", "lib", "email")), ...files(join("src", "lib", "report")), join("src", "lib", "onboarding", "qr-pack.tsx")].filter((f) => readFileSync(f, "utf8").includes("—"));
  expect(offenders).toEqual([]);
});

test("em-dashes are taken out of text owners and customers see", async () => {
  const { noEmDash } = await import("@/lib/text");
  const dash = String.fromCharCode(0x2014);
  expect(noEmDash(`Sorry about the wait ${dash} we'll fix it`)).toBe("Sorry about the wait, we'll fix it");
  expect(noEmDash(`12${dash}2pm`)).toBe("12-2pm");
});
