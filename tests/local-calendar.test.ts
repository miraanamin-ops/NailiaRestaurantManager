// The local calendar: which dates Growth drafts for (2 to 3 weeks ahead), the
// builder's form, gov.uk bank holidays added once, and each restaurant seeing only
// its own dates plus the shared ones.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { bankHolidayRows, entriesToDraft, entryProblems } from "@/lib/local-calendar-rules";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("rules", () => {
  test("Growth drafts 14 to 21 days ahead, soonest first", () => {
    const entries = [{ day: "2026-11-05" }, { day: "2026-10-26" }, { day: "2026-11-02" }, { day: "2026-10-25" }];
    // Today 12 October: 26 October is day 14, 2 November is day 21.
    expect(entriesToDraft(entries, "2026-10-12").map((e) => e.day)).toEqual(["2026-10-26", "2026-11-02"]);
  });

  test("the builder's form needs a real date, a name and a type", () => {
    expect(entryProblems({ day: "2026-12-25", name: "Christmas Day", type: "religious" })).toEqual([]);
    expect(entryProblems({ day: "25/12/2026", name: "", type: "party" })).toEqual(["a date like 2026-12-25", "a name", "a type"]);
  });

  test("bank holidays from gov.uk: only future ones not already there, for every restaurant", () => {
    const holidays = [
      { date: "2026-08-31", title: "Summer bank holiday" },
      { date: "2026-12-25", title: "Christmas Day" },
      { date: "2026-12-28", title: "Boxing Day (substitute day)" },
    ];
    const rows = bankHolidayRows(holidays, [{ day: "2026-12-25", name: "Christmas Day" }], "2026-10-12");
    expect(rows).toEqual([{ restaurant_id: null, day: "2026-12-28", name: "Boxing Day (substitute day)", type: "bank_holiday", date_uncertain: false, source: "gov.uk" }]);
  });
});

describe("in the database", () => {
  let db: ReturnType<typeof memoryDb>;
  beforeEach(() => {
    vi.resetModules();
    db = memoryDb({
      local_calendar: [
        { id: "c1", restaurant_id: null, day: "2026-10-31", name: "Halloween", type: "local_event", date_uncertain: false, source: "builder" },
        { id: "c2", restaurant_id: A, day: "2026-10-30", name: "Brick Lane food festival", type: "local_event", date_uncertain: false, source: "builder" },
        { id: "c3", restaurant_id: B, day: "2026-10-29", name: "Ilford market day", type: "local_event", date_uncertain: false, source: "builder" },
      ],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/bank-holidays", () => ({ bankHolidays: async () => [{ date: "2026-12-25", title: "Christmas Day" }] }));
  });
  afterEach(() => {
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/bank-holidays");
  });

  test("a restaurant sees its own dates and the shared ones, never another restaurant's", async () => {
    const { calendarFor } = await import("@/lib/local-calendar");
    expect((await calendarFor(A, "2026-10-01", "2026-12-31")).map((e) => e.name)).toEqual(["Brick Lane food festival", "Halloween"]);
  });

  test("bank holidays are added once", async () => {
    const { syncBankHolidays } = await import("@/lib/local-calendar");
    expect(await syncBankHolidays("2026-10-12")).toBe(1);
    expect(await syncBankHolidays("2026-10-12")).toBe(0);
    expect(db.tables.local_calendar.filter((e) => e.source === "gov.uk")).toHaveLength(1);
  });
});
