// The rota suggester's greedy fill, swaps, cost maths and flags (src/lib/rota/fill.ts),
// and the WhatsApp wording (src/lib/rota/message.ts). Pure code, no database.
import { describe, expect, test } from "vitest";
import { buildPlan, fill, labourPct, summarise, usualFromHistory, type FillDay, type FillInput, type PlannedShift } from "@/lib/rota/fill";
import { DEFAULT_SETTINGS, effectiveRules, openSpans } from "@/lib/rota/rules";
import { DUMMY_RULES, DUMMY_STAFF, noAvailability, type RotaStaff, type Weekday } from "@/lib/rota/types";
import { MINIMUM_NOTE, rotaDetailText, rotaDraftText, weekLabel } from "@/lib/rota/message";
import { DUMMY_PROFILE, dummyWeekAhead } from "@/lib/forecast/week-ahead-rules";

const WEEK = "2026-11-02"; // a Monday
const date = (i: number) => new Date(Date.parse(`${WEEK}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

const person = (id: string, roles: string[], rate: number | null, days: Weekday[], starts = "11:00", ends = "23:00", max: number | null = null): RotaStaff => {
  const availability = noAvailability();
  for (const d of days) availability[d] = [{ starts, ends }];
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1), roles, hourly_rate_pence: rate, max_hours_week: max, availability };
};

const day = (i: number, open = "12:00 – 22:00", orders: Record<number, number> = {}, salesPence: number | null = null): FillDay => ({
  date: date(i),
  weekday: (i + 1) as Weekday,
  open: openSpans(open),
  ordersByHour: orders,
  orders: Object.values(orders).reduce((a, b) => a + b, 0) || null,
  salesPence,
});

const week = (open = "12:00 – 22:00", orders: Record<number, number> = {}, sales: number | null = null) => Array.from({ length: 7 }, (_, i) => day(i, open, orders, sales));

const input = (over: Partial<FillInput>): FillInput => ({
  staff: [],
  rules: [{ role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 }],
  settings: DEFAULT_SETTINGS,
  days: week(),
  basis: "forecast",
  ...over,
});

const ALL: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

describe("greedy fill", () => {
  test("the cheapest available person who fits gets the shift", () => {
    const staff = [person("dear", ["kitchen"], 1500, ALL), person("cheap", ["kitchen"], 1200, ALL), person("mid", ["kitchen"], 1300, ALL)];
    const shifts = fill(input({ staff, days: [day(0)] }));
    expect(shifts).toEqual([{ staffId: "cheap", role: "kitchen", date: date(0), start: 12 * 60, end: 22 * 60 }]);
  });

  test("someone who usually works that day counts as 50p an hour cheaper (history)", () => {
    const staff = [person("cheap", ["kitchen"], 1200, ALL), person("usual", ["kitchen"], 1240, ALL)];
    const usual = { usual: { 1: 3 } };
    expect(fill(input({ staff, days: [day(0)], usual }))[0].staffId).toBe("usual");
    // 50p isn't enough to beat someone 60p cheaper
    const staff2 = [person("cheap", ["kitchen"], 1200, ALL), person("usual", ["kitchen"], 1260, ALL)];
    expect(fill(input({ staff: staff2, days: [day(0)], usual }))[0].staffId).toBe("cheap");
    // once in recent weeks isn't "usually"
    expect(fill(input({ staff, days: [day(0)], usual: { usual: { 1: 1 } } }))[0].staffId).toBe("cheap");
  });

  test("minimum per role whenever open, one more per X forecast orders an hour", () => {
    const staff = ["a", "b", "c", "d"].map((id, i) => person(id, ["kitchen"], 1200 + i, ALL));
    // 12 to 22; 30 orders at 18:00 and 19:00 = 1 + floor(30/12) = 3 in the kitchen then
    const shifts = fill(input({ staff, days: [day(0, "12:00 – 22:00", { 18: 30, 19: 30 })] }));
    const at = (min: number) => shifts.filter((s) => s.start <= min && min < s.end).length;
    expect(at(13 * 60)).toBe(1);
    expect(at(18 * 60)).toBe(3);
    expect(at(19 * 60 + 30)).toBe(3);
    // extra shifts are at least 4 hours, inside the opening hours
    for (const s of shifts) {
      expect(s.end - s.start).toBeGreaterThanOrEqual(240);
      expect(s.start).toBeGreaterThanOrEqual(12 * 60);
      expect(s.end).toBeLessThanOrEqual(22 * 60);
    }
  });

  test("minimum basis ignores the forecast", () => {
    const staff = ["a", "b", "c"].map((id, i) => person(id, ["kitchen"], 1200 + i, ALL));
    const shifts = fill(input({ staff, basis: "minimum", days: [day(0, "12:00 – 22:00", { 18: 30 })] }));
    expect(shifts).toHaveLength(1);
  });

  test("shifts are 4 to 10 hours: a long day is two overlapping shifts", () => {
    const staff = [person("a", ["kitchen"], 1200, ALL), person("b", ["kitchen"], 1300, ALL)];
    const shifts = fill(input({ staff, days: [day(0, "11:00 – 23:00")] }));
    expect(shifts.map((s) => [s.staffId, s.start / 60, s.end / 60])).toEqual([
      ["a", 11, 21],
      ["b", 19, 23],
    ]);
  });

  test("availability, one shift a day, and the weekly cap are respected", () => {
    const staff = [
      person("evenings", ["kitchen"], 1000, ALL, "17:00", "23:00"),
      person("capped", ["kitchen"], 1100, ALL, "11:00", "23:00", 20),
      person("backup", ["kitchen"], 1500, ALL),
    ];
    const plan = buildPlan(input({ staff }));
    for (const d of plan.days) {
      // evenings can't do 12 to 22, so it's never theirs; capped does 2 days of 10h then stops
      expect(d.shifts.map((s) => s.staffId)).not.toContain("evenings");
      expect(new Set(d.shifts.map((s) => s.staffId)).size).toBe(d.shifts.length);
    }
    expect(plan.byStaff.find((s) => s.staffId === "capped")?.hours).toBe(20);
    // backup does Wed to Sat (40h), then only 8 more hours fit under 48: Sunday 14 to 22, the rest open
    expect(plan.byStaff.find((s) => s.staffId === "backup")?.hours).toBe(48);
    expect(plan.days[6].shifts.map((s) => [s.staffId, s.start / 60, s.end / 60])).toEqual([
      [null, 12, 16],
      ["backup", 14, 22],
    ]);
  });

  test("never schedules anyone over 48 hours or with under 11 hours' rest", () => {
    const staff = [person("only", ["kitchen"], 1200, ALL, "00:00", "23:59")];
    const plan = buildPlan(input({ staff, days: week("12:00 – 22:00") }));
    expect(plan.byStaff[0].hours).toBeLessThanOrEqual(48);
    expect(plan.flags.filter((f) => f.kind === "over_week" || f.kind === "short_rest")).toEqual([]);
    // 4 days of 10 hours = 40; a fifth would be 50, so Friday to Sunday stay open
    expect(plan.days.flatMap((d) => d.shifts).filter((s) => s.staffId === null).length).toBeGreaterThan(0);
    // a late close then an early start: 23:00 to 09:00 is 10 hours, so not the same person
    const late = buildPlan(input({ staff, days: [day(0, "16:00 – 23:00"), day(1, "09:00 – 15:00")] }));
    expect(late.days[1].shifts[0].staffId).toBeNull();
  });

  test("a part shift when nobody can do all of it, an open shift when nobody can do any", () => {
    const staff = [person("lunch", ["kitchen"], 1200, ALL, "11:00", "17:00")];
    const plan = buildPlan(input({ staff, days: [day(0, "12:00 – 22:00")] }));
    const s = plan.days[0].shifts.map((x) => [x.staffId, x.start / 60, x.end / 60]);
    expect(s).toEqual([
      ["lunch", 12, 17],
      [null, 17, 22],
    ]);
    expect(plan.flags.map((f) => f.kind)).toContain("open_shift");
  });

  test("closed days have no shifts; past-midnight closing works", () => {
    const staff = [person("a", ["kitchen"], 1200, ALL, "17:00", "02:00")];
    const plan = buildPlan(input({ staff, days: [day(0, "Closed"), day(1, "18:00 – 01:00")] }));
    expect(plan.days[0].shifts).toEqual([]);
    expect(plan.days[1].shifts.map((x) => [x.staffId, x.start / 60, x.end / 60])).toEqual([["a", 18, 25]]);
  });

  test("time off and 'can't do' edits take someone out; 'can do' adds a day", () => {
    const staff = [person("ali", ["kitchen"], 1000, [1, 2, 3, 4, 5]), person("bo", ["kitchen"], 1300, ALL)];
    const plan = buildPlan(
      input({
        staff,
        timeOff: { ali: [date(0)] },
        adjustments: [
          { type: "unavailable", staffId: "ali", dates: [date(4)] },
          { type: "available", staffId: "ali", dates: [date(6)] },
        ],
      }),
    );
    const who = plan.days.map((d) => d.shifts[0]?.staffId);
    expect(who).toEqual(["bo", "ali", "ali", "ali", "bo", "bo", "ali"]);
  });

  test("swaps exchange two people's shifts that day, then get checked like any shift", () => {
    const staff = [person("sara", ["front"], 1100, ALL), person("bilal", ["kitchen"], 1100, ALL)];
    const rules = [
      { role: "kitchen", min_on_shift: 1, orders_per_extra_staff: null },
      { role: "front", min_on_shift: 1, orders_per_extra_staff: null },
    ];
    const plan = buildPlan(input({ staff, rules, days: [day(5), day(6)], adjustments: [{ type: "swap", a: "sara", b: "bilal", dates: [date(6)] }] }));
    const sun = plan.days[1].shifts.map((s) => [s.role, s.staffId]);
    expect(sun).toEqual([
      ["front", "bilal"],
      ["kitchen", "sara"],
    ]);
    // Saturday unchanged
    expect(plan.days[0].shifts.map((s) => [s.role, s.staffId])).toEqual([
      ["front", "sara"],
      ["kitchen", "bilal"],
    ]);
    expect(plan.flags.filter((f) => f.kind === "wrong_role").map((f) => f.text)).toEqual([
      "Sara isn't set up for kitchen (Sun 12–22)",
      "Bilal isn't set up for front of house (Sun 12–22)",
    ]);
  });

  test("a swap with someone who isn't working that day moves the shift", () => {
    const staff = [person("a", ["kitchen"], 1000, ALL), person("b", ["kitchen"], 1500, ALL)];
    const plan = buildPlan(input({ staff, adjustments: [{ type: "swap", a: "a", b: "b", dates: [date(2)] }] }));
    expect(plan.days[2].shifts[0].staffId).toBe("b");
    const none = buildPlan(input({ staff: [person("x", ["kitchen"], 1, ALL), person("y", ["front"], 1, [])], days: [day(0, "Closed")], adjustments: [{ type: "swap", a: "x", b: "y", dates: [date(0)] }] }));
    expect(none.notes).toEqual(["Couldn't swap X and Y on Mon: neither is on the rota that day."]);
  });
});

describe("cost maths", () => {
  const staff = [person("a", ["kitchen"], 1250, ALL), person("b", ["front"], 1221, ALL), person("c", ["kitchen"], null, ALL)];
  const shift = (staffId: string | null, role: string, i: number, start: number, end: number): PlannedShift => ({ staffId, role, date: date(i), start: start * 60, end: end * 60 });

  test("hours x rate to the penny, per shift, day and week", () => {
    const days = [day(0, "12:00 – 22:00", {}, 100_000), day(1, "12:00 – 22:00", {}, 50_000), ...week().slice(2)];
    const plan = summarise(
      [shift("a", "kitchen", 0, 12, 22), shift("b", "front", 0, 17.5, 22), shift("a", "kitchen", 1, 12, 16)],
      input({ staff, days }),
    );
    // 10h x £12.50 = £125.00; 4.5h x £12.21 = £54.945 -> £54.95 (5495p)
    expect(plan.days[0].shifts.map((s) => s.costPence)).toEqual([12500, 5495]);
    expect(plan.days[0].costPence).toBe(17995);
    expect(plan.days[0].hours).toBe(14.5);
    expect(plan.days[0].labourPct).toBe(18); // 179.95 / 1000
    expect(plan.days[1].costPence).toBe(5000);
    expect(plan.days[1].labourPct).toBe(10);
    expect(plan.totals).toMatchObject({ hours: 18.5, costPence: 22995, salesPence: 150_000, labourPct: 15.3, salesDays: 2, openDays: 7 });
    expect(plan.byStaff).toEqual([
      { staffId: "a", name: "A", hours: 14, costPence: 17500, shifts: 2 },
      { staffId: "b", name: "B", hours: 4.5, costPence: 5495, shifts: 1 },
    ]);
  });

  test("labour % is only over days with a forecast; no sales = no %", () => {
    expect(labourPct(5000, null)).toBeNull();
    expect(labourPct(5000, 0)).toBeNull();
    expect(labourPct(1, 3)).toBe(33.3);
    const plan = summarise([shift("a", "kitchen", 0, 12, 22)], input({ staff, days: week() }));
    expect(plan.totals.labourPct).toBeNull();
  });

  test("no pay rate: not costed, flagged; open shifts costed at the role's average rate, flagged", () => {
    const plan = summarise([shift("c", "kitchen", 0, 12, 22), shift(null, "kitchen", 1, 12, 22)], input({ staff }));
    expect(plan.days[0].shifts[0].costPence).toBeNull();
    // the only kitchen rate known is a's £12.50: 10h = £125, an estimate
    expect(plan.days[1].shifts[0]).toMatchObject({ costPence: 12500, estimated: true });
    expect(plan.totals).toMatchObject({ costPence: 12500, openShiftHours: 10 });
    expect(plan.flags.map((f) => f.kind).sort()).toEqual(["no_rate", "open_shift"]);
    expect(plan.byStaff[0].costPence).toBeNull();
  });

  test("flags over 48 hours, over someone's own cap, and under 11 hours between shifts", () => {
    const capped = [person("a", ["kitchen"], 1000, ALL, "00:00", "23:59", 30)];
    const shifts = [0, 1, 2, 3, 4].map((i) => shift("a", "kitchen", i, 12, 22));
    expect(summarise(shifts, input({ staff: capped })).flags.map((f) => f.text)).toEqual(["A: 50 hours this week, over 48"]);
    expect(summarise(shifts.slice(0, 4), input({ staff: capped })).flags.map((f) => f.text)).toEqual(["A: 40 hours, more than their 30-hour limit"]);
    const rest = summarise([shift("a", "kitchen", 0, 15, 23), shift("a", "kitchen", 1, 8, 14)], input({ staff: capped }));
    expect(rest.flags.map((f) => f.text)).toEqual(["A: only 9 hours off between Mon and Tue (needs 11)"]);
  });
});

describe("history", () => {
  test("weeks each person worked each weekday", () => {
    const rows = [
      { staff_id: "a", business_date: "2026-10-19" }, // Mon
      { staff_id: "a", business_date: "2026-10-26" }, // Mon
      { staff_id: "a", business_date: "2026-10-26" }, // same week again
      { staff_id: "a", business_date: "2026-10-31" }, // Sat
      { staff_id: null, business_date: "2026-10-31" },
    ];
    expect(usualFromHistory(rows)).toEqual({ a: { 1: 2, 6: 1 } });
  });
});

describe("Test Kitchen's dummy week makes a sensible rota", () => {
  const ahead = dummyWeekAhead("tk", WEEK);
  const days: FillDay[] = ahead.days.map((d) => ({
    date: d.date,
    weekday: d.weekday as Weekday,
    open: openSpans(d.weekday === 5 || d.weekday === 6 ? "12:00 – 23:00" : "12:00 – 22:00"),
    ordersByHour: Object.fromEntries(d.orders_by_hour.map((h) => [h.hour, h.orders])),
    orders: d.orders,
    salesPence: d.sales_mid,
  }));
  const plan = buildPlan({ staff: DUMMY_STAFF, rules: effectiveRules(DUMMY_RULES, DUMMY_STAFF), settings: DEFAULT_SETTINGS, days, basis: "forecast" });

  test("everyone within their limits, labour in a believable range", () => {
    for (const s of plan.byStaff) {
      const p = DUMMY_STAFF.find((x) => x.id === s.staffId)!;
      expect(s.hours).toBeLessThanOrEqual(Math.min(p.max_hours_week ?? 48, 48));
    }
    expect(plan.flags.filter((f) => f.kind !== "open_shift")).toEqual([]);
    expect(plan.totals.labourPct).toBeGreaterThan(10);
    expect(plan.totals.labourPct).toBeLessThan(45);
    expect(DUMMY_PROFILE.orders.length).toBe(7);
  });

  test("busier evenings get more people than quiet afternoons", () => {
    const sat = plan.days[5];
    const at = (min: number) => sat.shifts.filter((s) => s.start <= min && min < s.end).length;
    expect(at(19 * 60)).toBeGreaterThan(at(15 * 60));
  });

  test("the WhatsApp card fits the 1024-character button limit; the detail fits 1600", () => {
    const card = rotaDraftText(WEEK, plan, { previous: { weekStart: "2026-10-26", costPence: plan.totals.costPence - 5000, hours: 100 } });
    expect(card.length).toBeLessThanOrEqual(1024);
    expect(card).toContain("Rota for next week");
    expect(card).toMatch(/\d%\* of forecast sales/);
    expect(card).toContain("(+£50)");
    expect(rotaDetailText(WEEK, plan).length).toBeLessThanOrEqual(1600);
    expect(rotaDetailText(WEEK, plan)).toMatch(/\*Mon\* K .+ · F /);
  });

  test("under 8 weeks of history, the draft says it's minimum staffing only", () => {
    const min = buildPlan({ staff: DUMMY_STAFF, rules: effectiveRules(DUMMY_RULES, DUMMY_STAFF), settings: DEFAULT_SETTINGS, days, basis: "minimum" });
    expect(rotaDraftText(WEEK, min)).toContain(MINIMUM_NOTE);
    expect(min.totals.costPence).toBeLessThan(plan.totals.costPence);
  });

  test("week labels", () => {
    expect(weekLabel("2026-11-02")).toBe("Mon 2 – Sun 8 Nov");
    expect(weekLabel("2026-10-26")).toBe("Mon 26 Oct – Sun 1 Nov");
  });
});
