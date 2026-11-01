// The saved daily forecast (lib/forecast/snapshot.ts, migration 055): the brief,
// the Monday report, the rota and Insights read one copy per restaurant per day,
// so they can never show different numbers for the same day, even when a forecast
// refresh lands between the report and the brief. Last week in the report is what
// that Monday's brief said. Before 055 has run, everything works out live as
// before. Plus the migration itself (PGlite).
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { forecastLine } from "@/lib/finance/rules";
import { dummyWeekAhead, type WeekAhead } from "@/lib/forecast/week-ahead-rules";
import { newFullDb, readMigration } from "./support/full-pg";
import { memoryDb } from "./support/memory-db";

const R = "aaaaaaaa-0000-4000-8000-000000000055";
const MONDAY = "2026-11-02";
const LAST_MONDAY = "2026-10-26";
const at = (iso: string) => new Date(iso);
// The week as the 05:35 run had it (A), and after the 07:00 refresh (B: 20% up).
const A: WeekAhead = { ...dummyWeekAhead(R, MONDAY), source: "forecast", status: "ok", show_ranges: true };
const scaled = (w: WeekAhead, k: number): WeekAhead => ({ ...w, days: w.days.map((d) => ({ ...d, sales_low: Math.round(d.sales_low! * k), sales_mid: Math.round(d.sales_mid! * k), sales_high: Math.round(d.sales_high! * k), orders: Math.round(d.orders! * k) })) });
const B = scaled(A, 1.2);

let db: ReturnType<typeof memoryDb>;
const getWeekAhead = vi.fn();
const weekForecastAsOf = vi.fn();

beforeEach(() => {
  vi.resetModules();
  getWeekAhead.mockReset();
  weekForecastAsOf.mockReset();
  db = memoryDb({ restaurants: [{ id: R, name: "Ember Grill" }], forecast_snapshots: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/forecast/week-ahead", () => ({ getWeekAhead, weekForecastAsOf }));
  vi.doMock("@/lib/finance/labour", () => ({ labourForWeek: async () => ({ status: "none", costPence: 0, hours: 0, byDay: {}, missingRates: 0 }), labourTarget: async () => null }));
  vi.doMock("@/lib/calendar-lines", () => ({ linesBetween: async () => [], schoolCoverage: async () => ({ status: "covered" }), calendarBlock: async () => null }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/forecast/week-ahead", "@/lib/finance/labour", "@/lib/calendar-lines"]) vi.doUnmock(m);
});

describe("one saved copy a day", () => {
  test("worked out once and saved; later the same day the saved copy, whatever changed; the next day afresh", async () => {
    const { savedWeekAhead } = await import("@/lib/forecast/snapshot");
    getWeekAhead.mockResolvedValueOnce(A).mockResolvedValueOnce(B).mockResolvedValueOnce(B);
    expect(await savedWeekAhead(R, MONDAY, at("2026-11-02T07:01:00Z"))).toEqual(A);
    expect(await savedWeekAhead(R, MONDAY, at("2026-11-02T07:30:00Z"))).toEqual(A); // the refresh has landed: still A today
    expect(getWeekAhead).toHaveBeenCalledTimes(1);
    expect(db.tables.forecast_snapshots).toEqual([expect.objectContaining({ restaurant_id: R, week_start: MONDAY, made_on: MONDAY })]);
    expect(await savedWeekAhead(R, MONDAY, at("2026-11-03T07:01:00Z"))).toEqual(B); // Tuesday: worked out again
  });

  test("before 055 has run (no table): worked out live each time, as before", async () => {
    const real = db.client;
    const noTable = { ...real, from: (t: string) => (t === "forecast_snapshots" ? missingTable() : real.from(t)) };
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => noTable }));
    const { savedWeekAhead, toldForWeek } = await import("@/lib/forecast/snapshot");
    getWeekAhead.mockResolvedValueOnce(A).mockResolvedValueOnce(B);
    expect(await savedWeekAhead(R, MONDAY, at("2026-11-02T07:01:00Z"))).toEqual(A);
    expect(await savedWeekAhead(R, MONDAY, at("2026-11-02T07:30:00Z"))).toEqual(B);
    expect(await toldForWeek(R, LAST_MONDAY)).toBeNull();
  });
});

describe("the report and the brief on a Monday", () => {
  test("a forecast refresh landing between the report and the brief doesn't change the brief's numbers", async () => {
    // A 7am brief on Monday 2 Nov (the clock the report reads too).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-02T07:01:00Z"));
    // 07:01: the morning job builds the Monday report first (the 05:35 forecast, A)...
    getWeekAhead.mockResolvedValue(A);
    weekForecastAsOf.mockResolvedValue({ aov: null, days: [] });
    const sections = await import("@/lib/sections/finance");
    const restaurant = { id: R, name: "Ember Grill" } as never;
    const period = { prevStart: at("2026-10-19T00:00:00Z"), start: at("2026-10-26T00:00:00Z"), end: at("2026-11-02T00:00:00Z") };
    const report = await sections.nextWeekReportSection.build({ restaurant, period });

    // ...then the 07:00 refresh lands (B), and a minute later the brief step runs,
    // on another server (nothing kept in memory).
    getWeekAhead.mockResolvedValue(B);
    vi.setSystemTime(at("2026-11-02T07:02:30Z"));
    vi.resetModules();
    const again = await import("@/lib/sections/finance");
    const brief = await again.financeBriefSection.block({ restaurant, now: new Date() });
    vi.useRealTimers();

    const lineA = forecastLine(A, "https://app.test/sales?r=" + R)!;
    expect(lineA).not.toBe(forecastLine(B, "https://app.test/sales?r=" + R));
    expect(report?.lines).toContain(lineA.replace(/^📈 /, ""));
    expect(brief).toContain(lineA);
    expect(getWeekAhead).toHaveBeenCalledTimes(1); // the brief read the saved copy
  });

  test("Last week shows what that Monday's brief said, not a forecast worked out again", async () => {
    const told: WeekAhead = { ...dummyWeekAhead(R, LAST_MONDAY), status: "ok", show_ranges: true };
    db.tables.forecast_snapshots.push({ restaurant_id: R, week_start: LAST_MONDAY, made_on: LAST_MONDAY, data: told });
    // Worked out again today it would say something else (half), and the actual takings.
    weekForecastAsOf.mockImplementation(async (_r: string, ws: string) => ({
      aov: 2000,
      days: dummyWeekAhead(R, ws).days.map((d) => ({ date: d.date, sales_low: d.sales_low! / 2, sales_mid: d.sales_mid! / 2, sales_high: d.sales_high! / 2, actual_pence: d.sales_mid, actual_orders: d.orders })),
    }));
    const { lastWeekReportSection } = await import("@/lib/sections/finance");
    const s = await lastWeekReportSection.build({ restaurant: { id: R, name: "Ember Grill" } as never, period: { prevStart: at("2026-10-19T00:00:00Z"), start: at("2026-10-26T00:00:00Z"), end: at("2026-11-02T00:00:00Z") } });
    expect(s?.lines.join(" ")).toMatch(/: on forecast/); // actual = what the brief said
    expect(s?.footnote).toMatch(/^Forecast: what your brief said that Monday/);
  });

  test("toldDays: a forecast that was held back (not shown) counts as none", async () => {
    const { toldDays } = await import("@/lib/sections/finance");
    const actual = [{ date: LAST_MONDAY, sales_low: 1, sales_mid: 2, sales_high: 3, actual_pence: 5, actual_orders: 1 }];
    const held = { ...dummyWeekAhead(R, LAST_MONDAY), status: "held_back" as const, show_ranges: false };
    expect(toldDays(actual, held)[0]).toMatchObject({ sales_mid: null, actual_pence: 5 });
    expect(toldDays(actual, { ...held, show_ranges: true })[0].sales_mid).toBe(held.days[0].sales_mid);
  });
});

// A query on a table that isn't there, as PostgREST answers it.
function missingTable() {
  const answer = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.forecast_snapshots' in the schema cache" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order", "limit", "returns", "upsert"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok);
  return chain;
}

describe("055_forecast_snapshots.sql", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await newFullDb();
  }, 120_000);
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, params)).rows[0];

  test("records itself, runs again safely, one copy per restaurant, week and day, with RLS; the rollback undoes it", async () => {
    await pg.exec(readMigration("055_forecast_snapshots.sql"));
    expect(await one("select count(*)::int as n from schema_migrations where name = '055_forecast_snapshots.sql'")).toEqual({ n: 1 });
    await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'Snapshots', true)", [R]);
    await pg.query("insert into forecast_snapshots (restaurant_id, week_start, made_on, data) values ($1, '2026-11-02', '2026-11-02', '{}')", [R]);
    await expect(pg.query("insert into forecast_snapshots (restaurant_id, week_start, made_on, data) values ($1, '2026-11-02', '2026-11-02', '{}')", [R])).rejects.toThrow(/duplicate/);
    expect(await one("select relrowsecurity as rls from pg_class where relname = 'forecast_snapshots'")).toEqual({ rls: true });
    await pg.exec(readMigration("rollback/forecast_snapshots_rollback.sql"));
    expect(await one("select to_regclass('forecast_snapshots') is null as gone")).toEqual({ gone: true });
    await pg.exec(readMigration("055_forecast_snapshots.sql"));
    expect(await one("select to_regclass('forecast_snapshots') is not null as back")).toEqual({ back: true });
  });
});
