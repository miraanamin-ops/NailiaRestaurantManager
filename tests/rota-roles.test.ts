// Rota roles, suggested staffing and learning from past rotas (owner's plan, 12 Nov 2026):
// the plain-code parts. lib/rota/rules.ts, presets.ts, learn.ts, import-rules.ts, fill.ts.
import { describe, expect, test } from "vitest";
import { buildPlan, dayEdges, ruleSpans, type FillDay, type FillInput } from "@/lib/rota/fill";
import { checkSummary, parseStaffingWords, placeShifts, rulesFromCard, staffingCard, staffingLine, staffingText } from "@/lib/rota/import-rules";
import { labourFromRotas, learnFromRotas, type ImportedShift, type LearnDay } from "@/lib/rota/learn";
import { bandFor, suggestedRules } from "@/lib/rota/presets";
import { canDo, channelShares, DEFAULT_SETTINGS, ordersFor, roleKey } from "@/lib/rota/rules";
import { noAvailability, type RotaStaff, type Weekday } from "@/lib/rota/types";

const every = (starts = "00:00", ends = "23:59") => {
  const a = noAvailability();
  for (const d of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) a[d] = [{ starts, ends }];
  return a;
};
const person = (id: string, roles: string[], rate: number, extra: Partial<RotaStaff> = {}): RotaStaff => ({
  id,
  name: id,
  roles,
  hourly_rate_pence: rate,
  max_hours_week: null,
  availability: every(),
  ...extra,
});
const day = (date: string, weekday: Weekday, open: { start: number; end: number }[], ordersByHour: Record<number, number> = {}): FillDay => ({
  date,
  weekday,
  open,
  ordersByHour,
  orders: Object.values(ordersByHour).reduce((a, b) => a + b, 0) || null,
  salesPence: null,
});

describe("roles", () => {
  test("a person's main role first; what they can also do after; older all-round roles stay main", () => {
    expect(canDo(["chef", "counter"], "chef")).toBe("main");
    expect(canDo(["chef", "counter"], "counter")).toBe("also");
    expect(canDo(["head chef"], "chef")).toBe("main");
    expect(canDo(["chef"], "kitchen")).toBe("main");
    expect(canDo(["server"], "front")).toBe("main");
    expect(canDo(["kitchen"], "kitchen_porter")).toBe("also");
    expect(canDo(["front", "kitchen"], "kitchen")).toBe("main");
    expect(canDo(["server"], "chef")).toBeNull();
    expect(roleKey("Kitchen Porter")).toBe("kitchen_porter");
  });

  test("each channel's share of orders, from how the restaurant serves; unknown counts all orders", () => {
    expect(channelShares(["dine_in"])).toEqual({
      eat_in: 1,
      takeaway: 0,
      delivery: 0,
    });
    expect(channelShares(["dine_in", "takeaway", "delivery"])).toEqual({
      eat_in: 0.5,
      takeaway: 0.25,
      delivery: 0.25,
    });
    expect(channelShares(null)).toBeNull();
    expect(ordersFor({ driver: "eat_in" }, 20, channelShares(["dine_in", "takeaway"]))).toBe(12);
    expect(ordersFor({ driver: "eat_in" }, 20, null)).toBe(20);
    expect(ordersFor({ driver: null }, 20, channelShares(["dine_in"]))).toBe(20); // an older rule: all orders
    expect(ordersFor({ driver: "none" }, 20, null)).toBe(0);
  });
});

describe("suggested staffing for the restaurant's size", () => {
  test("the band: no eating in is no seating; unknown seats with eating in is 30 to 60", () => {
    expect(bandFor("60_100", ["dine_in"])).toBe("60_100");
    expect(bandFor("60_100", ["takeaway", "delivery"])).toBe("none");
    expect(bandFor(null, ["dine_in"])).toBe("30_60");
  });

  test("only the roles the team has; a head chef counts as a chef; the numbers from the agreed table", () => {
    const team = [{ roles: ["head_chef"] }, { roles: ["chef"] }, { roles: ["kitchen_porter"] }, { roles: ["server", "counter"] }, { roles: ["manager"] }];
    const s = suggestedRules({
      seats: "30_60",
      venueTypes: ["dine_in", "takeaway"],
      staff: team,
    });
    expect(s.band).toBe("30_60");
    expect(s.rules.map((r) => [r.role, r.min_on_shift, r.orders_per_extra_staff, r.driver])).toEqual([
      ["manager", 1, null, "none"],
      ["chef", 2, 15, "all"],
      ["kitchen_porter", 1, null, "all"],
      ["server", 1, 8, "eat_in"],
    ]);
    expect(s.rules.find((r) => r.role === "chef")).toMatchObject({
      before_open_minutes: 30,
      preset: "seats:30_60",
    });
    expect(s.rules.find((r) => r.role === "kitchen_porter")).toMatchObject({
      after_close_minutes: 30,
    });
    expect(s.notes).toEqual([]);
  });

  test("a takeaway: counter and drivers by their own orders; no servers suggested", () => {
    const s = suggestedRules({
      seats: "none",
      venueTypes: ["takeaway", "delivery"],
      staff: [{ roles: ["chef"] }, { roles: ["counter"] }, { roles: ["driver"] }],
    });
    expect(s.rules.map((r) => [r.role, r.min_on_shift, r.orders_per_extra_staff, r.driver])).toEqual([
      ["chef", 1, 15, "all"],
      ["counter", 1, 20, "takeaway"],
      ["driver", 0, 4, "delivery"],
    ]);
  });

  test("notes for roles that seem to be missing, never extra rules for them", () => {
    const s = suggestedRules({
      seats: "60_100",
      venueTypes: ["dine_in", "delivery"],
      staff: [{ roles: ["chef"] }, { roles: ["server"] }],
    });
    expect(s.rules.map((r) => r.role)).toEqual(["chef", "server"]);
    expect(s.notes.join(" ")).toMatch(/no kitchen porter/);
    expect(s.notes.join(" ")).toMatch(/manager or supervisor/);
    expect(s.notes.join(" ")).toMatch(/No drivers on the team/);
  });

  test("an older all-round team: its kitchen rule takes the chef numbers; mixed with chefs it isn't counted twice", () => {
    expect(
      suggestedRules({
        seats: "under_30",
        venueTypes: ["dine_in"],
        staff: [{ roles: ["kitchen"] }, { roles: ["front"] }],
      }).rules.map((r) => [r.role, r.min_on_shift]),
    ).toEqual([
      ["kitchen", 1],
      ["front", 1],
    ]);
    expect(
      suggestedRules({
        seats: "under_30",
        venueTypes: ["dine_in"],
        staff: [{ roles: ["kitchen"] }, { roles: ["chef"] }],
      }).rules.map((r) => r.role),
    ).toEqual(["chef"]);
  });
});

describe("the fill with the new rules", () => {
  const base = (staff: RotaStaff[], rules: FillInput["rules"], days: FillDay[], extra: Partial<FillInput> = {}): FillInput => ({
    staff,
    rules,
    settings: DEFAULT_SETTINGS,
    days,
    basis: "forecast",
    ...extra,
  });

  test("time before opening and after closing stretches the shifts", () => {
    expect(
      ruleSpans([{ start: 720, end: 1320 }], {
        before_open_minutes: 30,
        after_close_minutes: 15,
      }),
    ).toEqual([{ start: 690, end: 1335 }]);
    // A split day's pieces join up if the extra time meets.
    expect(
      ruleSpans(
        [
          { start: 720, end: 900 },
          { start: 930, end: 1320 },
        ],
        { before_open_minutes: 30 },
      ),
    ).toEqual([{ start: 690, end: 1320 }]);
    expect(
      dayEdges(
        [{ start: 720, end: 1320 }],
        [
          {
            role: "chef",
            min_on_shift: 1,
            orders_per_extra_staff: null,
            before_open_minutes: 30,
          },
          {
            role: "kitchen_porter",
            min_on_shift: 0,
            orders_per_extra_staff: null,
            after_close_minutes: 30,
          },
        ],
      ),
    ).toEqual({ start: 690, end: 1350 });
    const plan = buildPlan(
      base(
        [person("Aisha", ["chef"], 1400)],
        [
          {
            role: "chef",
            min_on_shift: 1,
            orders_per_extra_staff: null,
            before_open_minutes: 30,
          },
        ],
        [day("2026-11-16", 1, [{ start: 1020, end: 1320 }])],
      ),
    );
    expect(plan.days[0].shifts.map((s) => [s.name, s.start, s.end])).toEqual([["Aisha", 990, 1320]]);
  });

  test("servers follow eat-in orders only", () => {
    const rule = {
      role: "server",
      min_on_shift: 1,
      orders_per_extra_staff: 8,
      driver: "eat_in" as const,
    };
    const team = [person("A", ["server"], 1300), person("B", ["server"], 1300), person("C", ["server"], 1300)];
    const busy = day("2026-11-16", 1, [{ start: 1080, end: 1320 }], {
      18: 20,
      19: 20,
      20: 20,
      21: 20,
    });
    // All 20 orders an hour eaten in: 1 + 2 = 3 servers. Half delivery: 1 + 1 = 2.
    expect(new Set(buildPlan(base(team, [rule], [busy], { shares: channelShares(["dine_in"]) })).days[0].shifts.map((s) => s.staffId)).size).toBe(3);
    expect(
      new Set(
        buildPlan(
          base(team, [rule], [busy], {
            shares: channelShares(["dine_in", "delivery"]),
          }),
        ).days[0].shifts.map((s) => s.staffId),
      ).size,
    ).toBe(2);
  });

  test("someone whose main job it is goes first; covering another role is flagged", () => {
    const rule = {
      role: "counter",
      min_on_shift: 1,
      orders_per_extra_staff: null,
    };
    const d = [day("2026-11-16", 1, [{ start: 1080, end: 1320 }])];
    // Mo is cheaper but counter isn't his main job (300p an hour dearer): Sara gets it.
    const plan = buildPlan(base([person("Mo", ["server", "counter"], 1221), person("Sara", ["counter"], 1300)], [rule], d));
    expect(plan.days[0].shifts.map((s) => s.name)).toEqual(["Sara"]);
    const only = buildPlan(base([person("Mo", ["server", "counter"], 1221)], [rule], d));
    expect(only.days[0].shifts.map((s) => s.name)).toEqual(["Mo"]);
    expect(only.flags.map((f) => f.kind)).toContain("other_role");
  });

  test("a key holder opens and locks up when one is free; a day without one is flagged", () => {
    const rule = {
      role: "server",
      min_on_shift: 1,
      orders_per_extra_staff: null,
    };
    const d = [day("2026-11-16", 1, [{ start: 1080, end: 1320 }])];
    const keys = buildPlan(base([person("Cheap", ["server"], 1221), person("Keys", ["server"], 1500, { can_open_close: true })], [rule], d));
    expect(keys.days[0].shifts.map((s) => s.name)).toEqual(["Keys"]);
    expect(keys.flags.filter((f) => f.kind === "no_key_holder")).toEqual([]);
    const away = buildPlan(
      base(
        [
          person("Cheap", ["server"], 1221),
          person("Keys", ["server"], 1500, {
            can_open_close: true,
            availability: noAvailability(),
          }),
        ],
        [rule],
        d,
      ),
    );
    expect(away.flags.find((f) => f.kind === "no_key_holder")?.text).toBe("Mon: nobody on the rota who can open up or lock up");
    // Nobody marked at all: no flag (the owner hasn't told us).
    expect(buildPlan(base([person("Cheap", ["server"], 1221)], [rule], d)).flags.filter((f) => f.kind === "no_key_holder")).toEqual([]);
    // Switched off in the settings: no preference and no flag.
    expect(
      buildPlan(
        base([person("Cheap", ["server"], 1221), person("Keys", ["server"], 1500, { can_open_close: true })], [rule], d, { settings: { ...DEFAULT_SETTINGS, key_holder: false } }),
      ).days[0].shifts.map((s) => s.name),
    ).toEqual(["Cheap"]);
  });
});

// ---------- Learning from past rotas ----------

// Two weeks Mon to Sun, open 5pm to 11pm. Chefs: 1 always, a second from 7pm to
// 10pm when it's busy (Fri, Sat). A porter stays half an hour after close.
const DATES = Array.from({ length: 14 }, (_, i) => new Date(Date.parse("2026-10-26T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
const wd = (date: string) => (((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;
const busy = (date: string) => wd(date) === 5 || wd(date) === 6;
const shifts: ImportedShift[] = DATES.flatMap((date) => [
  { name: "Aisha", role: "chef", date, start: 990, end: 1380 },
  ...(busy(date) ? [{ name: "Tomasz", role: "chef", date, start: 1140, end: 1320 }] : []),
  { name: "Ravi", role: "kp", date, start: 1080, end: 1410 },
]);
const learnDays = (hourly: boolean): LearnDay[] =>
  DATES.map((date) => {
    const perHour = busy(date) ? { 17: 6, 18: 10, 19: 18, 20: 18, 21: 18, 22: 6 } : { 17: 4, 18: 6, 19: 8, 20: 8, 21: 6, 22: 3 };
    return {
      date,
      weekday: wd(date),
      open: [{ start: 1020, end: 1380 }],
      orders: Object.values(perHour).reduce((a, b) => a + b, 0),
      ordersByHour: hourly ? perHour : null,
    };
  });

describe("learning from past rotas", () => {
  test("the minimum, the busy rule, the time before opening and after closing", () => {
    const l = learnFromRotas({ shifts, days: learnDays(true), shares: null })!;
    expect(l).toMatchObject({
      weeks: 2,
      from: "2026-10-26",
      to: "2026-11-08",
      shifts: 32,
      salesDays: 14,
    });
    const chef = l.roles.find((r) => r.role === "chef")!;
    expect(chef).toMatchObject({
      min_on_shift: 1,
      basis: "hourly",
      enough: true,
      before_open_minutes: 30,
      after_close_minutes: 0,
    });
    // A second chef at 18 orders an hour: one more per about 18.
    expect(chef.orders_per_extra_staff).toBeGreaterThanOrEqual(15);
    expect(chef.orders_per_extra_staff).toBeLessThanOrEqual(25);
    const kp = l.roles.find((r) => r.role === "kitchen_porter")!;
    expect(kp).toMatchObject({ min_on_shift: 0, after_close_minutes: 30 }); // not on from 5pm to 6pm, so 0 at the quietest
  });

  test("with daily sales only, the busy rule is an estimate; with no sales, minimums only", () => {
    const daily = learnFromRotas({
      shifts,
      days: learnDays(false),
      shares: null,
    })!;
    expect(daily.roles.find((r) => r.role === "chef")).toMatchObject({
      basis: "daily",
      min_on_shift: 1,
    });
    expect(daily.roles.find((r) => r.role === "chef")!.orders_per_extra_staff).not.toBeNull();
    const none = learnFromRotas({
      shifts,
      days: learnDays(false).map((d) => ({ ...d, orders: null })),
      shares: null,
    })!;
    expect(none.roles.find((r) => r.role === "chef")).toMatchObject({
      basis: "minimum",
      orders_per_extra_staff: null,
    });
  });

  test("too few days: the numbers aren't trusted (the seat-count suggestion is used instead)", () => {
    const few = shifts.filter((s) => s.date <= "2026-10-28");
    expect(
      learnFromRotas({
        shifts: few,
        days: learnDays(true),
        shares: null,
      })!.roles.every((r) => !r.enough),
    ).toBe(true);
  });

  test("people: their usual role, days and times; who opens and who locks up", () => {
    const l = learnFromRotas({ shifts, days: [], shares: null })!;
    expect(l.people.map((p) => [p.name, p.role, p.days, p.starts, p.ends, p.opens, p.closes])).toEqual([
      ["Aisha", "chef", [1, 2, 3, 4, 5, 6, 7], "16:30", "23:00", true, false],
      ["Ravi", "kitchen_porter", [1, 2, 3, 4, 5, 6, 7], "18:00", "23:30", false, true],
      ["Tomasz", "chef", [5, 6], "19:00", "22:00", false, false],
    ]);
  });

  test("labour % over the rota's days, once most hours have a rate", () => {
    const sales = Object.fromEntries(DATES.map((d) => [d, 100_000]));
    const l = labourFromRotas({
      shifts,
      ratePenceByName: { Aisha: 1500, Tomasz: 1300, "Ravi Kumar": 1221 },
      salesPenceByDate: sales,
    })!;
    expect(l.days).toBe(14);
    expect(l.pct).toBeGreaterThan(10);
    expect(l.pct).toBeLessThan(20);
    expect(labourFromRotas({ shifts, ratePenceByName: {}, salesPenceByDate: sales })).toBeNull();
  });
});

describe("placing the shifts read from a rota", () => {
  test("dates from the rota, else the week's Monday plus the weekday; undated weeks are the last ones before today", () => {
    const placed = placeShifts(
      [
        {
          week_start: null,
          shifts: [
            {
              name: "Ali",
              role: "Chef",
              date: null,
              weekday: 5,
              start: "17:00",
              end: "01:00",
            },
          ],
        },
        {
          week_start: "2026-11-02",
          shifts: [
            {
              name: "Sara",
              role: "FOH",
              date: null,
              weekday: 1,
              start: "12:00",
              end: "18:00",
            },
          ],
        },
        {
          week_start: null,
          shifts: [
            {
              name: "Ali",
              role: "Chef",
              date: null,
              weekday: 5,
              start: "17:00",
              end: "23:00",
            },
            {
              name: "Ali",
              role: "Chef",
              date: null,
              weekday: 5,
              start: "17:00",
              end: "23:00",
            },
          ],
        },
      ],
      "2026-11-12",
    );
    expect(placed.assumed).toBe(true);
    expect(placed.shifts.map((s) => [s.name, s.role, s.date, s.start, s.end])).toEqual([
      ["Ali", "chef", "2026-10-30", 1020, 1500], // past midnight; the first undated week is the week before last
      ["Sara", "front", "2026-11-02", 720, 1080],
      ["Ali", "chef", "2026-11-06", 1020, 1380], // the same shift read twice is one
    ]);
  });

  test("unreadable times and future days are left out and counted", () => {
    const placed = placeShifts(
      [
        {
          week_start: "2026-11-09",
          shifts: [
            {
              name: "Ali",
              role: null,
              date: null,
              weekday: 1,
              start: "late",
              end: "23:00",
            },
            {
              name: "Ali",
              role: null,
              date: "2026-11-20",
              weekday: 5,
              start: "17:00",
              end: "23:00",
            },
          ],
        },
      ],
      "2026-11-12",
    );
    expect(placed).toMatchObject({ shifts: [], unplaced: 2 });
    expect(
      checkSummary({
        shifts: [],
        weeks: 0,
        assumed: false,
        unplaced: 2,
        unknownRoles: 0,
      }),
    ).toBe("I couldn't read any shifts from that.");
  });
});

describe("the staffing card", () => {
  const suggestion = suggestedRules({
    seats: "30_60",
    venueTypes: ["dine_in"],
    staff: [{ roles: ["chef"] }, { roles: ["kitchen_porter"] }, { roles: ["server"] }],
  });
  const learned = learnFromRotas({
    shifts,
    days: learnDays(true),
    shares: null,
  });

  test("prefilled from their rotas where there's enough, else the suggestion for their size", () => {
    const card = staffingCard({ suggestion, learned });
    expect(card.source).toBe("mixed"); // chefs and the porter from the rotas, servers from the suggestion
    const chef = card.rows.find((r) => r.role === "chef")!;
    expect(chef).toMatchObject({
      min: 1,
      suggested: { min: 2, per: 15 },
      learned: { min: 1, estimate: false },
      edges: "Starts 30 minutes before opening",
    });
    expect(card.rows.find((r) => r.role === "server")).toMatchObject({
      min: 1,
      per: 8,
      orders: "eat-in orders",
      learned: null,
    });
    expect(staffingText(card, "30_60", 2)).toMatch(/^How many people do you need on shift\? I've filled this in from your rotas where I could/);
    expect(staffingText(staffingCard({ suggestion, learned: null }), "30_60", null)).toMatch(/what restaurants with 30 to 60 seats usually need/);
  });

  test("the owner's numbers saved as rules: changed rows are the owner's, the rest keep where they came from", () => {
    const card = staffingCard({ suggestion, learned });
    const { rules, problems } = rulesFromCard(card, { server: { min: 2, per: 10 } }, learned, suggestion);
    expect(problems).toEqual([]);
    expect(rules.map((r) => [r.role, r.min_on_shift, r.orders_per_extra_staff, r.preset])).toEqual([
      ["chef", 1, card.rows[0].per, "learned"],
      ["kitchen_porter", 0, card.rows[1].per, "learned"],
      ["server", 2, 10, "owner"],
    ]);
    expect(rulesFromCard(card, { chef: { min: 40, per: null } }, learned, suggestion).problems).toEqual(["Chef: at least 40 doesn't look right (0 to 20)."]);
    expect(
      staffingLine({
        label: "Server",
        min: 2,
        per: 10,
        orders: "eat-in orders",
      }),
    ).toBe("Server: at least 2, plus 1 more per 10 eat-in orders an hour");
    expect(
      staffingLine({
        label: "Kitchen porter",
        min: 0,
        per: 20,
        orders: "orders",
      }),
    ).toBe("Kitchen porter: 1 per 20 orders an hour when busy");
  });

  test("a change typed in words, read by code", () => {
    const rows = [
      { role: "chef", label: "Chef", min: 2, per: 15 },
      { role: "kitchen_porter", label: "Kitchen porter", min: 1, per: null },
      { role: "server", label: "Server", min: 1, per: 8 },
    ];
    expect(parseStaffingWords("3 chefs, porter only when busy and 1 more server per 10 orders", rows)).toEqual({
      changes: {
        chef: { min: 3, per: 15 },
        kitchen_porter: { min: 0, per: null },
        server: { min: 1, per: 10 },
      },
      unread: [],
    });
    expect(parseStaffingWords("at least two waiters", rows).changes).toEqual({
      server: { min: 2, per: 8 },
    });
    expect(parseStaffingWords("no KP", rows).changes).toEqual({
      kitchen_porter: { min: 0, per: null },
    });
    expect(parseStaffingWords("chefs 4", rows).changes).toEqual({
      chef: { min: 4, per: 15 },
    });
    expect(parseStaffingWords("more at weekends please", rows)).toEqual({
      changes: {},
      unread: ["more at weekends please"],
    });
  });
});

describe("open shifts on a rota", () => {
  test("an OPEN SHIFT row counts as a needed shift, never as a person", async () => {
    const { isOpenShift } = await import("@/lib/rota/learn");
    expect(["OPEN SHIFT chef", "Open shift", "TBC", "Unassigned"].every(isOpenShift)).toBe(true);
    expect(["Openshaw", "Tobi", "Opeyemi"].some(isOpenShift)).toBe(false);
    const withOpen: ImportedShift[] = [...shifts, { name: "OPEN SHIFT chef", role: "chef", date: "2026-10-30", start: 1140, end: 1320 }];
    const l = learnFromRotas({ shifts: withOpen, days: learnDays(true), shares: null })!;
    expect(l.people.map((p) => p.name)).toEqual(["Aisha", "Ravi", "Tomasz"]);
    expect(checkSummary({ shifts: withOpen, weeks: 2, assumed: false, unplaced: 0, unknownRoles: 0 })).toMatch(/3 people and 33 shifts/);
  });

  test("rows that don't add up to the hours the rota prints are named on the card", async () => {
    const { hoursDoubts } = await import("@/lib/rota/import-rules");
    const week = { week_start: "2026-11-02", shifts: [{ name: "Ali", role: null, date: null, weekday: 1, start: "17:00", end: "23:00" }, { name: "Sara", role: null, date: null, weekday: 1, start: "17:00", end: "00:30" }], hours_shown: [{ name: "Ali", hours: 6 }, { name: "Sara", hours: 12 }] };
    expect(hoursDoubts([week])).toEqual(["Sara"]);
    expect(checkSummary({ shifts: [{ name: "Ali", role: "chef", date: "2026-11-02", start: 1020, end: 1380 }], weeks: 1, assumed: false, unplaced: 0, unknownRoles: 0, doubts: ["Sara", "Omar"] })).toMatch(
      /Sara and Omar don't add up to the hours on your rota, so please check those rows first\. Is this right\?$/,
    );
  });
});
