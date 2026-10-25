// The pilot sprint's shared contracts (docs/pilot-sprint.md): getWeekAhead,
// getUpcomingEvents, getRotaInputs and the brief and report section registry.
// Real data first; in test mode a demo restaurant with none gets typed dummy data.
import { describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "./support/fake-supabase";
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
  const load = async (loaded: unknown, dummy: boolean, hours: unknown[] = []) => {
    vi.resetModules();
    vi.doMock("@/lib/forecast", () => ({ loadForecast: async () => loaded }));
    vi.doMock("@/lib/dummy-data", () => ({ dummyDataAllowed: async () => dummy }));
    vi.doMock("@/lib/ops/models", () => ({ forecastHoursFromRun: async () => hours }));
    return (await import("@/lib/forecast/week-ahead")).getWeekAhead;
  };

  test("no forecast: dummy data in test mode, else seven empty days", async () => {
    const none = { kind: "none", hadRecently: false, reason: "" };
    expect((await (await load(none, true))(RID, MONDAY, NOW)).source).toBe("dummy");
    const empty = await (await load(none, false))(RID, MONDAY, NOW);
    expect(empty.source).toBe("none");
    expect(empty.days).toHaveLength(7);
    expect(empty.days.every((d) => d.orders === null && d.sales_mid === null && !d.orders_by_hour.length)).toBe(true);
  });

  test("the nightly forecast in the contract's shape, rounded, with hours", async () => {
    const days = new Map([
      [MONDAY, { orders: { low: 50, likely: 61.6, high: 70 }, sales: { low: 100000.4, likely: 120000.6, high: 140000 }, covers: null, channels: new Map(), drivers: [] }],
    ]);
    const loaded = { kind: "forecast", run: { id: "run-1", metrics: {} }, unvalidated: true, metrics: {}, days };
    const hours = [
      { target_day: MONDAY, local_hour: 19, likely: 9.26 },
      { target_day: MONDAY, local_hour: 12, likely: 4.04 },
    ];
    const w = await (await load(loaded, true, hours))(RID, MONDAY, NOW);
    expect(w.source).toBe("forecast");
    expect(w.unvalidated).toBe(true);
    expect(w.days[0]).toEqual({
      date: MONDAY,
      weekday: 1,
      orders: 62,
      sales_low: 100000,
      sales_mid: 120001,
      sales_high: 140000,
      orders_by_hour: [{ hour: 12, orders: 4 }, { hour: 19, orders: 9.3 }],
    });
    expect(w.days[1]).toMatchObject({ date: "2026-10-27", orders: null, orders_by_hour: [] });
  });

  test("refuses a week that doesn't start on a Monday", async () => {
    await expect((await load(null, true))(RID, "2026-10-27", NOW)).rejects.toThrow(/isn't a Monday/);
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
