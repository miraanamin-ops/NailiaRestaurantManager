// The pilot sprint's shared contracts (docs/pilot-sprint.md): getWeekAhead,
// getUpcomingEvents, getRotaInputs and the brief and report section registry.
// Real data first; in test mode a demo restaurant with none gets typed dummy data
// (except the week ahead: under 8 weeks of sales it has no numbers, never dummy ones).
import { afterAll, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "./support/fake-supabase";
import { memoryDb } from "./support/memory-db";
import { tkHistory } from "./support/tk-history";
import { dummyWeekAhead, isMonday, weekDays } from "@/lib/forecast/week-ahead-rules";
import { dummyUpcomingEvents, expectedEffect } from "@/lib/upcoming-events-rules";
import { DUMMY_RULES, DUMMY_STAFF } from "@/lib/rota/types";
import { runBriefSections, runReportSections, type BriefSectionDef, type ReportSectionDef } from "@/lib/sections/types";
import type { Restaurant } from "@/lib/supabase";
import type { Period } from "@/lib/report/build";

const RID = "7e57c0de-0000-4000-8000-000000000000";
const MONDAY = "2026-10-26";
const NOW = new Date("2026-10-25T09:00:00Z"); // the Sunday before

describe("week ahead (pure)", () => {
  test("seven days from a Monday", () => {
    expect(isMonday(MONDAY)).toBe(true);
    expect(isMonday("2026-10-25")).toBe(false);
    expect(isMonday("not a day")).toBe(false);
    expect(weekDays(MONDAY)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  test("dummy data: the same every time, sales ranges in order, hours add up to the day", () => {
    const w = dummyWeekAhead(RID, MONDAY);
    expect(w).toEqual(dummyWeekAhead(RID, MONDAY));
    expect(w.source).toBe("dummy");
    expect(w.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const d of w.days) {
      expect(d.sales_low!).toBeLessThan(d.sales_mid!);
      expect(d.sales_mid!).toBeLessThan(d.sales_high!);
      expect(d.orders_by_hour.reduce((s, h) => s + h.orders, 0)).toBeCloseTo(d.orders!, 0);
      expect(d.orders_by_hour.some((h) => h.hour === 22)).toBe(d.weekday === 5 || d.weekday === 6);
    }
    expect(w.days[5].orders!).toBeGreaterThan(w.days[1].orders!); // Saturday busier than Tuesday
  });
});

describe("getWeekAhead", () => {
  const TODAY = "2026-10-25"; // NOW's London day (a Sunday); the week asked for starts tomorrow
  const load = async (opts: { historyDays: number; loaded?: unknown; hours?: unknown[]; limit?: number | null }) => {
    vi.resetModules();
    const { salesDays, salesHours } = tkHistory(RID, TODAY, opts.historyDays);
    const db = memoryDb({
      restaurants: [{ id: RID, is_demo: true, forecast_error_limit_pct: opts.limit ?? null }],
      sales_days: salesDays,
      sales_hours: salesHours,
      forecast_backtests: [],
    });
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/forecast", () => ({ loadForecast: async () => opts.loaded ?? { kind: "none", hadRecently: false, reason: "" } }));
    vi.doMock("@/lib/ops/models", () => ({ forecastHoursFromRun: async () => opts.hours ?? [] }));
    vi.doMock("@/lib/local-calendar", () => ({ calendarFor: async () => [] }));
    vi.doMock("@/lib/upcoming-events", () => ({ getUpcomingEvents: async () => [] }));
    return { get: (await import("@/lib/forecast/week-ahead")).getWeekAhead, db };
  };
  afterAll(() => {
    for (const m of ["@/lib/supabase", "@/lib/forecast", "@/lib/ops/models", "@/lib/local-calendar", "@/lib/upcoming-events"]) vi.doUnmock(m);
  });

  test("under 8 weeks of sales: no numbers at all, even for a demo in test mode", async () => {
    const { get } = await load({ historyDays: 40 });
    const w = await get(RID, MONDAY, NOW);
    expect(w).toMatchObject({ source: "none", status: "not_enough_history", show_ranges: false, history_weeks: 5 });
    expect(w.days).toHaveLength(7);
    expect(w.days.every((d) => d.orders === null && d.sales_mid === null && !d.orders_by_hour.length)).toBe(true);
  });

  test("from the sales history: orders range x average order value, hours, and the back-test saved once a day", async () => {
    const { get, db } = await load({ historyDays: 365 });
    const w = await get(RID, MONDAY, NOW);
    expect(w).toMatchObject({ source: "history", status: "ok", show_ranges: true, unvalidated: false });
    expect(w.aov_pence).toBeGreaterThan(1900);
    expect(w.aov_pence).toBeLessThan(2100);
    for (const d of w.days) {
      expect(d.orders_low!).toBeLessThanOrEqual(d.orders!);
      expect(d.orders!).toBeLessThanOrEqual(d.orders_high!);
      expect(Math.abs(d.sales_mid! - d.orders! * w.aov_pence!)).toBeLessThan(w.aov_pence!); // orders rounded, sales not
      expect(d.orders_by_hour.reduce((n, h) => n + h.orders, 0)).toBeCloseTo(d.orders!, -1);
    }
    expect(w.days[5].orders!).toBeGreaterThan(w.days[1].orders!); // Saturday busier than Tuesday
    expect(w.accuracy).toMatchObject({ method: "history_v1", weeks: 12, limit_pct: 20 });
    expect(w.accuracy!.error_pct!).toBeLessThan(20);
    expect(db.tables.forecast_backtests).toHaveLength(1);
    await get(RID, MONDAY, NOW);
    expect(db.tables.forecast_backtests).toHaveLength(1); // read back, not run again
  });

  test("the error over the limit: held back, no ranges to show", async () => {
    const { get } = await load({ historyDays: 365, limit: 1 });
    const w = await get(RID, MONDAY, NOW);
    expect(w).toMatchObject({ status: "held_back", show_ranges: false });
    expect(w.accuracy).toMatchObject({ limit_pct: 1 });
  });

  test("the nightly forecast where it has a day: its orders x our average order value, its hours, its own error", async () => {
    const days = new Map([[MONDAY, { orders: { low: 50, likely: 61.6, high: 70 }, sales: null, covers: null, channels: new Map(), drivers: [] }]]);
    const loaded = { kind: "forecast", run: { id: "run-1", metrics: {} }, unvalidated: true, metrics: { primary: { wape: 0.123, coverage: 0.81 } }, days };
    const hours = [
      { target_day: MONDAY, local_hour: 19, likely: 9.26 },
      { target_day: MONDAY, local_hour: 12, likely: 4.04 },
    ];
    const { get } = await load({ historyDays: 365, loaded, hours });
    const w = await get(RID, MONDAY, NOW);
    expect(w).toMatchObject({ source: "forecast", unvalidated: true, accuracy: { method: "model", error_pct: 12.3, range_hit_pct: 81 } });
    expect(w.days[0]).toMatchObject({ orders: 62, orders_low: 50, orders_high: 70, sales_mid: Math.round(61.6 * w.aov_pence!), orders_by_hour: [{ hour: 12, orders: 4 }, { hour: 19, orders: 9.3 }] });
    expect(w.days[1].orders).not.toBeNull(); // the rest of the week from the history
  });

  test("refuses a week that doesn't start on a Monday", async () => {
    const { get } = await load({ historyDays: 365 });
    await expect(get(RID, "2026-10-27", NOW)).rejects.toThrow(/isn't a Monday/);
  });
});

describe("upcoming events", () => {
  test("expected effect: a first guess from the kind of date", () => {
    expect(expectedEffect("bank_holiday", "Christmas Day")).toBe("busier");
    expect(expectedEffect("sport", "West Ham v Arsenal")).toBe("busier");
    expect(expectedEffect("religious", "Ramadan begins")).toBe("quieter");
    expect(expectedEffect("religious", "Eid al-Fitr")).toBe("busier");
    expect(expectedEffect("school_holiday", "Half term")).toBe("neutral");
    expect(expectedEffect("restaurant", "Closed", "closure")).toBe("quieter");
    expect(expectedEffect("restaurant", "Offer running", "promotion")).toBe("busier");
  });

  test("dummy events: only between the dates, one kind of each effect a week", () => {
    const e = dummyUpcomingEvents(MONDAY, "2026-11-01");
    expect(e.map((x) => x.expected_effect).sort()).toEqual(["busier", "neutral", "quieter"]);
    expect(e.every((x) => x.source === "dummy" && x.date >= MONDAY && x.date <= "2026-11-01")).toBe(true);
  });

  const load = async (calendar: unknown[], own: unknown[], dummy: boolean) => {
    vi.resetModules();
    vi.doMock("@/lib/local-calendar", () => ({ calendarFor: async () => calendar }));
    vi.doMock("@/lib/ops/outside", () => ({ restaurantEventsBetween: async () => own }));
    vi.doMock("@/lib/dummy-data", () => ({ dummyDataAllowed: async () => dummy }));
    return (await import("@/lib/upcoming-events")).getUpcomingEvents;
  };

  test("the calendar and the restaurant's own events, one entry per day, soonest first", async () => {
    const get = await load(
      [{ id: "c1", restaurant_id: null, day: "2026-10-31", name: "Halloween match day", type: "sport", date_uncertain: false, source: "feed" }],
      [{ type: "closure", notes: "Kitchen refit", starts_at: "2026-10-27T09:00:00Z", ends_at: "2026-10-28T20:00:00Z", created_by: "owner" }],
      true,
    );
    expect(await get(RID, MONDAY, "2026-11-01")).toEqual([
      { date: "2026-10-27", title: "Closed: Kitchen refit", type: "restaurant", expected_effect: "quieter", source: "owner" },
      { date: "2026-10-28", title: "Closed: Kitchen refit", type: "restaurant", expected_effect: "quieter", source: "owner" },
      { date: "2026-10-31", title: "Halloween match day", type: "sport", expected_effect: "busier", source: "feed" },
    ]);
  });

  test("nothing: dummy events in test mode, else none", async () => {
    expect((await (await load([], [], true))(RID, MONDAY, "2026-11-01")).every((e) => e.source === "dummy")).toBe(true);
    expect(await (await load([], [], false))(RID, MONDAY, "2026-11-01")).toEqual([]);
  });
});

describe("getRotaInputs", () => {
  const STAFF = { id: "s1", display_name: "Aisha", roles: ["kitchen"], max_hours_week: "45.00", employment_start: "2025-01-01", employment_end: null };
  const load = async (staff: unknown[], dummy: boolean) => {
    vi.resetModules();
    const db = fakeSupabase(({ table }) => {
      if (table === "staff_pay_rates")
        return {
          data: [
            { staff_id: "s1", hourly_pence: 1500, effective_from: "2025-01-01", recorded_at: "2025-01-01T00:00:00Z", created_at: "2025-01-01T00:00:00Z" },
            { staff_id: "s1", hourly_pence: 1650, effective_from: "2026-10-01", recorded_at: "2026-09-20T00:00:00Z", created_at: "2026-09-20T00:00:00Z" },
            { staff_id: "s1", hourly_pence: 1800, effective_from: "2026-11-02", recorded_at: "2026-10-20T00:00:00Z", created_at: "2026-10-20T00:00:00Z" },
          ],
        };
      if (table === "staff_availability")
        return {
          data: [
            { staff_id: "s1", weekday: 5, starts: "17:00:00", ends: "23:00:00", effective_from: "2025-01-01", effective_to: null },
            { staff_id: "s1", weekday: 5, starts: "11:00:00", ends: "15:00:00", effective_from: "2025-01-01", effective_to: null },
            { staff_id: "s1", weekday: 1, starts: "11:00:00", ends: "23:00:00", effective_from: "2025-01-01", effective_to: "2026-01-01" },
          ],
        };
      if (table === "rota_rules") return { data: [{ role: "kitchen", min_on_shift: 2, orders_per_extra_staff: "12.0" }] };
      return { data: [] };
    });
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/ops/staff", () => ({ listStaff: async () => staff }));
    vi.doMock("@/lib/dummy-data", () => ({ dummyDataAllowed: async () => dummy }));
    return (await import("@/lib/rota/inputs")).getRotaInputs;
  };

  test("staff with the pay, cap and availability in force that Monday, and the rules", async () => {
    const r = await (await load([STAFF], true))(RID, MONDAY);
    expect(r.source).toBe("tables");
    expect(r.staff).toEqual([
      {
        id: "s1",
        name: "Aisha",
        roles: ["kitchen"],
        hourly_rate_pence: 1650,
        max_hours_week: 45,
        availability: { 1: [], 2: [], 3: [], 4: [], 5: [{ starts: "11:00", ends: "15:00" }, { starts: "17:00", ends: "23:00" }], 6: [], 7: [] },
      },
    ]);
    expect(r.rules).toEqual([{ role: "kitchen", min_on_shift: 2, orders_per_extra_staff: 12 }]);
  });

  test("no staff: the dummy team in test mode, else an empty list", async () => {
    expect(await (await load([], true))(RID, MONDAY)).toMatchObject({ source: "dummy", staff: DUMMY_STAFF, rules: DUMMY_RULES });
    expect(await (await load([{ ...STAFF, employment_end: "2026-01-31" }], false))(RID, MONDAY)).toMatchObject({ source: "tables", staff: [] });
  });
});

describe("section registry", () => {
  const restaurant = { id: RID, name: "Test Kitchen" } as Restaurant;
  const period = {} as Period;

  test("brief blocks in order; empty ones dropped; a failing one left out and reported", async () => {
    const failed = vi.fn();
    const defs: BriefSectionDef[] = [
      { id: "b", order: 20, block: async () => "*Rota*: 3 shifts need cover" },
      { id: "a", order: 10, block: async () => "*Events*: home match Saturday" },
      { id: "empty", order: 5, block: async () => "  " },
      { id: "broken", order: 1, block: async () => { throw new Error("boom"); } },
    ];
    expect(await runBriefSections(defs, { restaurant, now: NOW }, failed)).toEqual(["*Events*: home match Saturday", "*Rota*: 3 shifts need cover"]);
    expect(failed).toHaveBeenCalledWith("broken", expect.any(Error));
  });

  test("report sections keyed by feature, at most 3 numbers, facts collected", async () => {
    const failed = vi.fn();
    const stat = (label: string) => ({ label, value: { now: 1, before: 0 }, format: "count" as const });
    const defs: ReportSectionDef[] = [
      { id: "rota", order: 1, build: async () => ({ title: "Rota", stats: [stat("a"), stat("b"), stat("c"), stat("d")], lines: ["Labour 28%"] }), facts: () => "Labour was 28%." },
      { id: "none", order: 2, build: async () => null },
      { id: "broken", order: 3, build: async () => { throw new Error("boom"); } },
    ];
    const out = await runReportSections(defs, { restaurant, period }, failed);
    expect(out.sections).toEqual([{ id: "feature", key: "rota", title: "Rota", stats: [stat("a"), stat("b"), stat("c")], lines: ["Labour 28%"] }]);
    expect(out.facts).toEqual(["Labour was 28%."]);
    expect(failed).toHaveBeenCalledWith("broken", expect.any(Error));
  });

  test("the brief shows each feature's block after the forecast, unchanged", async () => {
    vi.resetModules();
    const { composeBrief } = await import("@/lib/brief");
    const brief = composeBrief({
      items: [],
      totalWaiting: 0,
      reviews: new Map(),
      names: new Map(),
      tally: [],
      forecast: "Today: 60 to 70 orders",
      sections: ["*Rota*: all covered"],
      restaurant: { discount_cap_percent: 20 },
    });
    expect(brief.summary.indexOf("*Rota*: all covered")).toBeGreaterThan(brief.summary.indexOf("Today: 60 to 70 orders"));
  });
});
