// The rota in the app: Reports > Rota (this week and next, from the saved plans) and
// Today's "Who's on today". Approved, waiting in the Inbox, or not made yet; costs and
// the labour % against the target for the owner; the team's link only once approved;
// never another restaurant's rota.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { appRotaWeek, mondayOf, todayOnRota, weekLabel } from "@/lib/app/rota-rules";
import { memoryDb } from "./support/memory-db";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const TOKEN = "owner-token-1234567";

const shift = (date: string, name: string | null, role: string, start: number, end: number) => ({ staffId: name ? `s-${name}` : null, name, role, date, start, end, hours: (end - start) / 60, costPence: 1200 * ((end - start) / 60) });
const plan = (monday: string) => ({
  basis: "forecast",
  days: [
    { date: monday, weekday: 1, open: [{ start: 720, end: 1320 }], orders: 80, salesPence: 150000, shifts: [shift(monday, "Sara", "front", 720, 1020), shift(monday, "Ali", "kitchen", 660, 1320), shift(monday, null, "kitchen", 1020, 1320)], hours: 21, costPence: 25200, labourPct: 16.8 },
    { date: `${monday.slice(0, 8)}${String(Number(monday.slice(8)) + 1).padStart(2, "0")}`, weekday: 2, open: [], orders: null, salesPence: null, shifts: [], hours: 0, costPence: 0, labourPct: null },
  ],
  totals: { hours: 21, costPence: 25200, salesPence: 150000, labourPct: 32, salesDays: 1, openDays: 1, openShiftHours: 5 },
  byStaff: [],
  flags: [{ kind: "open_shift", text: "Mon: nobody can take kitchen 5pm–10pm" }],
  notes: [],
});

describe("rota rules", () => {
  test("weeks and labels", () => {
    expect(mondayOf("2026-11-12")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(weekLabel("2026-11-09")).toBe("Mon 9 – Sun 15 Nov");
    expect(weekLabel("2026-11-30")).toBe("Mon 30 Nov – Sun 6 Dec");
  });

  test("a suggested week: waiting, with its draft, costs against the target, open shifts and flags; no team link yet", () => {
    const w = appRotaWeek({ week_start: "2026-11-09", status: "draft", summary: plan("2026-11-09") as never, draft_id: "d1", share_token: "tok" }, "2026-11-09", 28);
    expect(w).toMatchObject({ status: "waiting", draftId: "d1", shareToken: null, openShifts: 1, flags: ["Mon: nobody can take kitchen 5pm–10pm"] });
    expect(w.totals).toEqual({ hours: 21, costPence: 25200, labourPct: 32, target: 28, overTarget: true });
    expect(w.days).toHaveLength(7);
    expect(w.days[0].shifts.map((s) => [s.name, s.role, s.time])).toEqual([
      ["Ali", "Kitchen", "11am–10pm"],
      ["Sara", "Front of house", "12pm–5pm"],
      [null, "Kitchen", "5pm–10pm"],
    ]);
    expect(w.days[1].closed).toBe(true);
    expect(w.days[6]).toMatchObject({ closed: false, shifts: [] }); // not in the plan at all
  });

  test("approved: the team's link; not made yet: nothing; today's card from this week", () => {
    const approved = appRotaWeek({ week_start: "2026-11-09", status: "published", summary: plan("2026-11-09") as never, draft_id: "d1", share_token: "tok" }, "2026-11-09", null);
    expect(approved).toMatchObject({ status: "approved", draftId: null, shareToken: "tok" });
    expect(approved.totals?.overTarget).toBe(false);
    expect(appRotaWeek(null, "2026-11-16", 28)).toMatchObject({ status: "none", totals: null, openShifts: 0 });
    expect(todayOnRota(approved, "2026-11-09")).toMatchObject({ suggested: false, closed: false, shifts: [{ name: "Ali" }, { name: "Sara" }, { name: null }] });
    expect(todayOnRota(appRotaWeek(null, "2026-11-09", null), "2026-11-09")).toBeNull();
  });
});

describe("/api/app/rota", () => {
  let mem: ReturnType<typeof memoryDb>;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z")); // a Thursday
    mem = memoryDb({
      restaurants: [
        { id: A, name: "Ember & Spice", labour_target_pct: 30 },
        { id: B, name: "Cardamom" },
      ],
      rota_weeks: [
        { restaurant_id: A, week_start: "2026-11-09", status: "published", summary: plan("2026-11-09"), draft_id: "d0", share_token: "team-link-token" },
        { restaurant_id: A, week_start: "2026-11-16", status: "draft", summary: plan("2026-11-16"), draft_id: "d1", share_token: "x" },
        { restaurant_id: B, week_start: "2026-11-09", status: "published", summary: plan("2026-11-09"), draft_id: "dB", share_token: "b-token" },
      ],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => mem.client }));
    vi.doMock("@/lib/auth", async (orig) => ({
      ...(await orig<object>()),
      ownerFromToken: async (t: string) => (t === TOKEN ? { email: "sam@ember.test", isBuilder: false, restaurantIds: [A], allowed: true } : null),
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/auth");
  });

  test("this week (approved, with the team's link) and next (waiting in the Inbox); only the owner's own", async () => {
    const { GET } = await import("@/app/api/app/rota/route");
    expect((await GET(new NextRequest("https://app.test/api/app/rota"))).status).toBe(401);
    const json = await (await GET(new NextRequest(`https://app.test/api/app/rota?r=${B}`, { headers: { authorization: `Bearer ${TOKEN}` } }))).json();
    expect(json.today).toBe("2026-11-12");
    expect(json.thisWeek).toMatchObject({ weekStart: "2026-11-09", status: "approved", shareUrl: expect.stringMatching(/\/rota\/team-link-token$/) });
    expect(json.nextWeek).toMatchObject({ weekStart: "2026-11-16", status: "waiting", draftId: "d1", shareUrl: null });
    expect(json.thisWeek.totals.target).toBe(30);
  });

  test("Today gets who's on today", async () => {
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z")); // the Monday
    const { rotaToday } = await import("@/lib/app/rota");
    const today = await rotaToday(mem.tables.restaurants[0] as never);
    expect(today).toMatchObject({ date: "2026-11-09", suggested: false });
    expect(today!.shifts.map((s) => s.name)).toEqual(["Ali", "Sara", null]);
  });
});
