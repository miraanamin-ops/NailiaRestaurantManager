// How the rota suggester is wired in: the WhatsApp commands, the Thursday 10am
// job, UNDO, the Team page's login, and migration 045 on the full chain (PGlite).
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { parseCommand } from "@/lib/bot/parse";
import { londonTime } from "@/lib/clock";
import { needsLogin } from "@/lib/hosts";
import { plannedJobs, rotaDue, rotaWeekFor } from "@/lib/queue/rules";
import { isTestCommand } from "@/lib/test-mode";
import { undoPlan } from "@/lib/undo-plan";
import { nextWeekStart } from "@/lib/rota/build";
import { newFullDb, readMigration } from "./support/full-pg";

describe("WhatsApp commands", () => {
  test("RUN ROTA is a test command; ROTA isn't", () => {
    expect(parseCommand("run rota", 4)).toEqual({ name: "run_rota" });
    expect(parseCommand("ROTA", 4)).toEqual({ name: "rota" });
    expect(isTestCommand("run_rota")).toBe(true);
    expect(isTestCommand("rota")).toBe(false);
    // staff numbers (till reports) are still their own command
    expect(parseCommand("ADD STAFF +447700900123", 4)).toEqual({ name: "add_staff", number: "+447700900123" });
  });
});

describe("Thursday 10am", () => {
  const R = { id: "r1", hasOwnerChannel: true };
  const rota = (now: Date, r = R) => plannedJobs(r, "hourly", now, "not yet").filter((p) => p.type === "rota_week");

  test("queued from 10am UK on Thursdays only, once a week (one key per week)", () => {
    expect(rota(londonTime(2026, 10, 29, 9, 5))).toEqual([]);
    const at10 = rota(londonTime(2026, 10, 29, 10, 5));
    expect(at10.map((p) => p.key)).toEqual(["rota_week:r1:2026-11-02"]);
    expect(rota(londonTime(2026, 10, 29, 15, 5)).map((p) => p.key)).toEqual(["rota_week:r1:2026-11-02"]);
    expect(rota(londonTime(2026, 10, 30, 10, 5))).toEqual([]); // Friday
    expect(rota(londonTime(2026, 10, 29, 10, 5), { id: "r1", hasOwnerChannel: false })).toEqual([]);
    // the daily backup counts too (it runs at 9 or 10 UK)
    expect(plannedJobs(R, "daily", londonTime(2026, 10, 29, 10, 0), "not yet").map((p) => p.type)).toContain("rota_week");
  });

  test("the week is the Monday after", () => {
    expect(rotaDue(londonTime(2026, 10, 29, 10, 0))).toBe(true);
    expect(rotaWeekFor(londonTime(2026, 10, 29, 10, 0))).toBe("2026-11-02");
    expect(rotaWeekFor(londonTime(2026, 11, 1, 10, 0))).toBe("2026-11-02"); // a Sunday
    expect(nextWeekStart("2026-10-29")).toBe("2026-11-02");
    expect(nextWeekStart("2026-11-02")).toBe("2026-11-09"); // a Monday: the next one
  });
});

describe("UNDO on a rota", () => {
  const draft = (status: string) => ({ kind: "rota", status, review_id: null });
  test("approve -> unpublish; edit -> the earlier edits; nothing else", () => {
    expect(undoPlan({ action: "approved", data: null }, draft("approved"), "dummy")).toEqual({ type: "rota_unpublish" });
    expect(undoPlan({ action: "approved", data: null }, draft("pending"), "dummy")).toMatchObject({ type: "cannot" });
    const before = [{ type: "unavailable", staffId: "a", dates: ["2026-11-06"] }];
    expect(undoPlan({ action: "edited", data: { before_adjustments: before } }, draft("pending"), "dummy")).toEqual({ type: "rota_edit", adjustments: before });
    expect(undoPlan({ action: "edited", data: { before_adjustments: before } }, draft("approved"), "dummy")).toMatchObject({ type: "cannot" });
    expect(undoPlan({ action: "edited", data: {} }, draft("pending"), "dummy")).toMatchObject({ type: "cannot" });
    // skipping a rota undoes like any draft
    expect(undoPlan({ action: "skipped", data: null }, draft("skipped"), "dummy")).toEqual({ type: "restore_skip" });
  });
});

describe("pages", () => {
  test("the Team page needs a login; the published rota and its PDF don't", () => {
    expect(needsLogin("/staff")).toBe(true);
    expect(needsLogin("/rota/abc")).toBe(false);
    expect(needsLogin("/rota/abc/pdf")).toBe(false);
  });
});

describe("045_rota_suggester.sql", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await newFullDb();
  }, 120_000);

  test("runs again safely, records itself, allows rota drafts, one link per rota", async () => {
    await pg.exec(readMigration("045_rota_suggester.sql"));
    expect((await pg.query("select count(*)::int as n from schema_migrations where name = '045_rota_suggester.sql'")).rows[0]).toEqual({ n: 1 });
    const id = "a0a0a0a0-0000-0000-0000-000000000045";
    await pg.query("insert into restaurants (id, name, is_demo, rota_settings) values ($1, 'Rota', true, '{\"min_shift_hours\": 5}')", [id]);
    await pg.query("insert into drafts (restaurant_id, kind, content, status) values ($1, 'rota', 'x', 'pending')", [id]);
    await pg.query("insert into rota_weeks (restaurant_id, week_start, share_token, adjustments) values ($1, '2026-11-02', 'tok-1', '[]')", [id]);
    await expect(pg.query("insert into rota_weeks (restaurant_id, week_start, share_token) values ($1, '2026-11-09', 'tok-1')", [id])).rejects.toThrow(/duplicate/);
    expect((await pg.query("select runner from job_types where type = 'rota_week'")).rows[0]).toEqual({ runner: "app" });
  });

  test("the rollback undoes it", async () => {
    await pg.exec(readMigration("rollback/rota_suggester_rollback.sql"));
    expect((await pg.query("select count(*)::int as n from information_schema.columns where table_name = 'rota_weeks' and column_name = 'share_token'")).rows[0]).toEqual({ n: 0 });
    expect((await pg.query("select count(*)::int as n from drafts where kind = 'rota'")).rows[0]).toEqual({ n: 0 });
    await pg.exec(readMigration("045_rota_suggester.sql"));
  });
});
