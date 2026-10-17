// supabase/038_ops_data_gaps.sql on the full migration chain in PGlite: sunshine in
// the weather views, the per-restaurant trading day cut-off in analytics.sales_hourly,
// channel fees, and clearing one restaurant's dummy data without touching another's.
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb } from "./support/full-pg";

const A = "a0a0a0a0-0000-0000-0000-000000000001"; // demo
const B = "b0b0b0b0-0000-0000-0000-000000000002"; // demo
const REAL = "c0c0c0c0-0000-0000-0000-000000000003";

const one = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const all = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const count = async (pg: PGlite, sql: string, params: unknown[] = []) => (await one<{ n: number }>(pg, `select count(*)::int as n from ${sql}`, params)).n;

let pg: PGlite;
beforeAll(async () => {
  pg = await newFullDb();
  await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'A', true), ($2, 'B', true), ($3, 'Real', false)", [A, B, REAL]);
}, 120_000);

describe("sunshine", () => {
  test("is stored and shown in the weather views", async () => {
    await pg.query("insert into weather_hours (restaurant_id, hour_start, temp, sunshine_min) values ($1, '2026-07-01T12:00:00Z', 24, 55)", [A]);
    await pg.query("insert into weather_days (restaurant_id, day, temp_max, sunshine_hours, source) values ($1, '2026-07-01', 25, 11.5, 'archive')", [A]);
    await pg.query(
      "insert into weather_forecasts (restaurant_id, issued_at, target_day, temp_max, sunshine_hours) values ($1, '2026-06-30T00:00:00Z', '2026-07-01', 23, 9.0)",
      [A],
    );
    expect(await one(pg, "select sunshine_min from analytics.weather_hourly where restaurant_id = $1", [A])).toEqual({ sunshine_min: 55 });
    expect(await one(pg, "select sunshine_hours from analytics.weather_daily where restaurant_id = $1", [A])).toEqual({ sunshine_hours: "11.5" });
    expect(await one(pg, "select sunshine_hours from analytics.weather_forecasts where restaurant_id = $1", [A])).toEqual({ sunshine_hours: "9.0" });
    await expect(pg.query("insert into weather_hours (restaurant_id, hour_start, sunshine_min) values ($1, '2026-07-01T13:00:00Z', 61)", [A])).rejects.toThrow();
  });
});

describe("the trading day", () => {
  test("hours before the cut-off (default 05:00) happen on the next calendar date", async () => {
    expect(await one(pg, "select trading_day_cutoff::text as c from restaurants where id = $1", [A])).toEqual({ c: "05:00:00" });
    // Saturday 24 October 2026's trading day: 23:00, then 00:00 and 01:00 on Sunday 25th (the clock change).
    await pg.query("insert into sales_hours (restaurant_id, day, hour, sales, source) values ($1, '2026-10-24', 23, 10, 'pos'), ($1, '2026-10-24', 0, 20, 'pos'), ($1, '2026-10-24', 1, 30, 'pos')", [A]);
    const rows = await all(pg, "select hour, calendar_day::text, hour_start, minutes from analytics.sales_hourly where restaurant_id = $1 order by hour_start", [A]);
    expect(rows).toEqual([
      { hour: 23, calendar_day: "2026-10-24", hour_start: new Date("2026-10-24T22:00:00Z"), minutes: 60 },
      { hour: 0, calendar_day: "2026-10-25", hour_start: new Date("2026-10-24T23:00:00Z"), minutes: 60 },
      { hour: 1, calendar_day: "2026-10-25", hour_start: new Date("2026-10-25T00:00:00Z"), minutes: 120 },
    ]);
  });

  test("the cut-off is per restaurant, and whole hours only", async () => {
    await pg.query("update restaurants set trading_day_cutoff = '00:00' where id = $1", [B]);
    await pg.query("insert into sales_hours (restaurant_id, day, hour, sales, source) values ($1, '2026-10-25', 1, 30, 'pos')", [B]);
    expect(await one(pg, "select calendar_day::text, minutes from analytics.sales_hourly where restaurant_id = $1", [B])).toEqual({ calendar_day: "2026-10-25", minutes: 120 });
    await expect(pg.query("update restaurants set trading_day_cutoff = '04:30' where id = $1", [B])).rejects.toThrow(/trading_day_cutoff/);
  });
});

describe("channel fees", () => {
  test("are kept with spans, owned by the restaurant, and in the analytics views", async () => {
    await pg.query(
      "insert into channel_fees (restaurant_id, channel, fee_pct, fee_per_order_pence, effective_from, effective_to, notes, source) values ($1, 'delivery', 30, 0, '2025-01-01', '2026-01-01', 'Deliveroo', 'manual'), ($1, 'delivery', 32.5, 25, '2026-01-01', null, 'Deliveroo', 'manual')",
      [A],
    );
    expect(await all(pg, "select fee_pct, fee_per_order_pence from analytics.channel_fees where restaurant_id = $1 order by effective_from", [A])).toEqual([
      { fee_pct: "30.00", fee_per_order_pence: 0 },
      { fee_pct: "32.50", fee_per_order_pence: 25 },
    ]);
    await expect(pg.query("insert into channel_fees (restaurant_id, channel, fee_pct, effective_from) values ($1, 'delivery', 101, '2026-01-01')", [A])).rejects.toThrow();
    expect(await count(pg, "pg_policies where tablename = 'channel_fees'")).toBeGreaterThan(0);
  });
});

describe("clearing one restaurant's dummy data", () => {
  test("leaves other demo restaurants, shared venues still in use, and real rows alone", async () => {
    const db = await newFullDb();
    await db.query("insert into restaurants (id, name, is_demo) values ($1, 'A', true), ($2, 'B', true), ($3, 'Real', false)", [A, B, REAL]);
    for (const r of [A, B]) {
      await db.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Person', 'synthetic')", [r]);
      await db.query("insert into channel_fees (restaurant_id, channel, fee_pct, effective_from, source) values ($1, 'delivery', 30, '2026-01-01', 'synthetic')", [r]);
    }
    await db.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Real person', 'manual'), ($1, 'Fake person', 'synthetic')", [REAL]);
    // One shared synthetic venue, used by both demo restaurants' football events.
    const v = await one<{ id: string }>(db, "insert into venues (name, kind, latitude, longitude, source) values ('Stadium', 'stadium', 51.5, 0, 'synthetic') returning id");
    for (const r of [A, B]) {
      const e = await one<{ id: string }>(
        db,
        "insert into local_calendar (restaurant_id, day, name, type, source, venue_id) values ($1, '2026-09-01', 'Match', 'football', 'synthetic', $2) returning id",
        [r, v.id],
      );
      await db.query(
        "insert into football_fixtures (event_id, home_team, away_team, kickoff_at, venue_id, source) values ($1, 'West Ham', 'Spurs', '2026-09-01T19:00:00Z', $2, 'synthetic')",
        [e.id, v.id],
      );
    }

    const dry = await all<{ table_name: string; n_rows: number }>(db, "select table_name, n_rows::int from clear_ops_dummy_data(true, $1) where n_rows > 0", [A]);
    expect(Object.fromEntries(dry.map((r) => [r.table_name, r.n_rows]))).toEqual({ staff: 1, channel_fees: 1, football_fixtures: 1, local_calendar: 1 });

    await db.query("select * from clear_ops_dummy_data(false, $1)", [A]);
    expect(await count(db, "staff where restaurant_id = $1", [A])).toBe(0);
    expect(await count(db, "staff where restaurant_id = $1", [B])).toBe(1);
    expect(await count(db, "channel_fees where restaurant_id = $1", [B])).toBe(1);
    expect(await count(db, "staff where restaurant_id = $1", [REAL])).toBe(2);
    expect(await count(db, "football_fixtures")).toBe(1);
    expect(await count(db, "venues")).toBe(1); // B still uses it

    await db.query("select * from clear_ops_dummy_data(false, $1)", [B]);
    expect(await count(db, "venues")).toBe(0); // nothing uses it now
    expect(await count(db, "staff where restaurant_id = $1", [REAL])).toBe(2); // a restaurant's clear-out never touches another

    // The old call (no restaurant) still clears every synthetic row, as before.
    await db.query("select * from clear_ops_dummy_data(false)");
    expect(await all(db, "select display_name from staff where restaurant_id = $1", [REAL])).toEqual([{ display_name: "Real person" }]);
  }, 120_000);
});
