// Plain-English rota edits (src/lib/rota/edits.ts), staff by WhatsApp
// (src/lib/rota/staff-input.ts) and the rules (src/lib/rota/rules.ts). Pure code.
import { describe, expect, test } from "vitest";
import { datesIn, describeAdjustment, findStaff, mergeAdjustments, parseRotaEdits, splitEdits } from "@/lib/rota/edits";
import { parseDays, parseMaxHours, parseRate, parseStaffCommand, parseTimes } from "@/lib/rota/staff-input";
import { DEFAULT_RULES, effectiveRules, needFor, openingFor, openSpans, roleKey, rotaSettings, shortSpan } from "@/lib/rota/rules";

const WEEK = "2026-11-02"; // Monday
const STAFF = [
  { id: "ali", name: "Ali" },
  { id: "sara", name: "Sara K" },
  { id: "bilal", name: "Bilal" },
  { id: "aisha", name: "Aisha (head chef)" },
  { id: "mo1", name: "Mo" },
];

describe("rota edits", () => {
  test("the two examples from the brief", () => {
    expect(parseRotaEdits("Ali can't do Friday", STAFF, WEEK)).toEqual({ adjustments: [{ type: "unavailable", staffId: "ali", dates: ["2026-11-06"] }], unread: [], unknownNames: [] });
    expect(parseRotaEdits("swap Sara and Bilal on Sunday", STAFF, WEEK).adjustments).toEqual([{ type: "swap", a: "sara", b: "bilal", dates: ["2026-11-08"] }]);
  });

  test.each([
    ["Ali cant do friday", ["2026-11-06"]],
    ["ali can’t work Fri or Sat", ["2026-11-06", "2026-11-07"]],
    ["Ali is off Monday", ["2026-11-02"]],
    ["Ali's off on Tuesday", ["2026-11-03"]],
    ["Ali is on holiday all week", ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]],
    ["give Ali the weekend off", ["2026-11-07", "2026-11-08"]],
    ["Ali needs Thursday off", ["2026-11-05"]],
    ["take Ali off the rota on Wednesday", ["2026-11-04"]],
    ["Ali can't do Monday to Wednesday", ["2026-11-02", "2026-11-03", "2026-11-04"]],
    ["Ali won't make it mon-wed", ["2026-11-02", "2026-11-03", "2026-11-04"]],
    ["Aisha can't do Saturday", ["2026-11-07"]],
  ])("%s", (text, dates) => {
    const r = parseRotaEdits(text, STAFF, WEEK);
    expect(r.unread).toEqual([]);
    expect(r.adjustments).toEqual([{ type: "unavailable", staffId: text.toLowerCase().startsWith("aisha") ? "aisha" : "ali", dates }]);
  });

  test("can do, with or without times", () => {
    expect(parseRotaEdits("Mo can do Sunday", STAFF, WEEK).adjustments).toEqual([{ type: "available", staffId: "mo1", dates: ["2026-11-08"] }]);
    expect(parseRotaEdits("Bilal can work Tuesday 5pm-11pm", STAFF, WEEK).adjustments).toEqual([{ type: "available", staffId: "bilal", dates: ["2026-11-03"], starts: "17:00", ends: "23:00" }]);
    expect(parseRotaEdits("Bilal is free Tuesday evening", STAFF, WEEK).adjustments).toEqual([{ type: "available", staffId: "bilal", dates: ["2026-11-03"], starts: "17:00", ends: "23:59" }]);
  });

  test("several edits in one message", () => {
    const r = parseRotaEdits("Ali can't do Friday, and swap Sara and Bilal on Sunday. Mo is off Monday", STAFF, WEEK);
    expect(r.adjustments.map((a) => a.type)).toEqual(["unavailable", "swap", "unavailable"]);
    expect(splitEdits("Ali can't do Friday, Saturday")).toEqual(["ali can't do friday and saturday"]);
    expect(parseRotaEdits("Ali can't do Friday, Saturday", STAFF, WEEK).adjustments).toEqual([{ type: "unavailable", staffId: "ali", dates: ["2026-11-06", "2026-11-07"] }]);
    expect(splitEdits("Ali can't do Friday and Sara is off Monday")).toEqual(["ali can't do friday", "sara is off monday"]);
  });

  test("swaps: either wording, two-word names, no day = all week", () => {
    expect(parseRotaEdits("Sara K and Bilal swap on Saturday", STAFF, WEEK).adjustments).toEqual([{ type: "swap", a: "sara", b: "bilal", dates: ["2026-11-07"] }]);
    expect(parseRotaEdits("swap ali with mo", STAFF, WEEK).adjustments[0]).toMatchObject({ type: "swap", a: "ali", b: "mo1" });
    expect((parseRotaEdits("swap ali with mo", STAFF, WEEK).adjustments[0] as { dates: string[] }).dates).toHaveLength(7);
  });

  test("unknown names and unreadable parts are returned, not guessed", () => {
    expect(parseRotaEdits("Zed can't do Friday", STAFF, WEEK)).toEqual({ adjustments: [], unread: [], unknownNames: ["zed"] });
    expect(parseRotaEdits("make it cheaper", STAFF, WEEK).unread).toEqual(["make it cheaper"]);
    expect(parseRotaEdits("Ali can't do it", STAFF, WEEK).unread).toEqual(["ali can't do it"]);
  });

  test("names: full name, then a unique first name", () => {
    expect(findStaff(STAFF, "Sara")?.id).toBe("sara");
    expect(findStaff(STAFF, "aisha")?.id).toBe("aisha");
    expect(findStaff([...STAFF, { id: "ali2", name: "Ali B" }], "Ali")?.id).toBe("ali"); // full name wins
    expect(findStaff([{ id: "x", name: "Sam A" }, { id: "y", name: "Sam B" }], "sam")).toBeNull();
  });

  test("dates", () => {
    expect(datesIn("weekdays", WEEK)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(datesIn("next week", WEEK)).toHaveLength(7);
    expect(datesIn("nothing", WEEK)).toEqual([]);
  });

  test("a later edit overrides an earlier one for the same days", () => {
    const merged = mergeAdjustments(
      [{ type: "unavailable", staffId: "ali", dates: ["2026-11-06", "2026-11-07"] }],
      [{ type: "available", staffId: "ali", dates: ["2026-11-06"] }],
    );
    expect(merged).toEqual([
      { type: "unavailable", staffId: "ali", dates: ["2026-11-07"] },
      { type: "available", staffId: "ali", dates: ["2026-11-06"] },
    ]);
    expect(mergeAdjustments([{ type: "available", staffId: "ali", dates: ["2026-11-06"] }], [{ type: "unavailable", staffId: "ali", dates: ["2026-11-06"] }])).toEqual([
      { type: "unavailable", staffId: "ali", dates: ["2026-11-06"] },
    ]);
  });

  test("what was understood, in words", () => {
    expect(describeAdjustment({ type: "unavailable", staffId: "ali", dates: ["2026-11-06"] }, STAFF)).toBe("Ali off Friday");
    expect(describeAdjustment({ type: "swap", a: "sara", b: "bilal", dates: ["2026-11-08"] }, STAFF)).toBe("Sara K ⇄ Bilal on Sunday");
    expect(describeAdjustment({ type: "available", staffId: "ali", dates: ["2026-11-03"], starts: "17:00", ends: "23:59" }, STAFF)).toBe("Ali can work Tuesday (17:00–close)");
  });
});

describe("staff by WhatsApp", () => {
  test("the example from the brief", () => {
    expect(parseStaffCommand("add Ali, kitchen, £13, weekdays")).toEqual({
      name: "add_rota_staff",
      input: { name: "Ali", roles: ["kitchen"], ratePence: 1300, days: [1, 2, 3, 4, 5], starts: null, ends: null, maxHours: null },
    });
  });

  test("more details, any order", () => {
    expect(parseStaffCommand("Add sara k, front of house, £12.50, Fri-Sun, 5pm-11pm, max 20 hours")).toEqual({
      name: "add_rota_staff",
      input: { name: "Sara K", roles: ["front"], ratePence: 1250, days: [5, 6, 7], starts: "17:00", ends: "23:00", maxHours: 20 },
    });
    expect(parseStaffCommand("add Bilal, driver, 12.21ph, weekends evenings")?.name).toBe("add_rota_staff");
    expect(parseStaffCommand("add Bilal, driver, 12.21ph, weekends evenings")).toMatchObject({ input: { roles: ["delivery"], ratePence: 1221, days: [6, 7], starts: "17:00", ends: "23:59" } });
    expect(parseStaffCommand("add Zara, manager/front, £15")).toMatchObject({ input: { roles: ["manager", "front"], ratePence: 1500, days: null } });
  });

  test("not a staff command: dishes, staff numbers, anything unreadable", () => {
    expect(parseStaffCommand("add lamb chops, £14")).toBeNull(); // a dish (no role)
    expect(parseStaffCommand("ADD STAFF +447700900123")).toBeNull();
    expect(parseStaffCommand("add Ali, kitchen, sometimes")).toBeNull();
    expect(parseStaffCommand("add Ali")).toBeNull();
  });

  test("remove and list", () => {
    expect(parseStaffCommand("remove Ali from the team")).toEqual({ name: "remove_rota_staff", who: "Ali" });
    expect(parseStaffCommand("delete Sara K from staff")).toEqual({ name: "remove_rota_staff", who: "Sara K" });
    expect(parseStaffCommand("TEAM")).toEqual({ name: "team" });
    expect(parseStaffCommand("remove lamb chops")).toBeNull();
  });

  test("pieces", () => {
    expect(parseDays("Mon, Wed and Fri")).toEqual([1, 3, 5]);
    expect(parseDays("sat-mon")).toEqual([1, 6, 7]);
    expect(parseDays("every day")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parseDays("kitchen")).toBeNull();
    expect(parseTimes("12-10pm")).toEqual({ starts: "12:00", ends: "22:00" });
    expect(parseTimes("17:00 to 00:00")).toEqual({ starts: "17:00", ends: "23:59" });
    expect(parseRate("£13")).toBe(1300);
    expect(parseRate("13")).toBeNull();
    expect(parseRate("13.5 an hour")).toBe(1350);
    expect(parseMaxHours("up to 30h")).toBe(30);
    expect(parseMaxHours("30 hours a week")).toBe(30);
    expect(parseMaxHours("30")).toBeNull();
  });
});

describe("rota rules", () => {
  test("defaults for missing or odd settings", () => {
    expect(rotaSettings(null)).toEqual({ min_shift_hours: 4, max_shift_hours: 10, flag_week_hours: 48, flag_rest_hours: 11 });
    expect(rotaSettings({ min_shift_hours: 6, max_shift_hours: 3, flag_week_hours: "x" })).toEqual({ min_shift_hours: 3, max_shift_hours: 6, flag_week_hours: 48, flag_rest_hours: 11 });
  });

  test("saved rules win; defaults only for roles the team has", () => {
    const rules = effectiveRules([{ role: "Chef", min_on_shift: 2, orders_per_extra_staff: 8 }], [{ roles: ["kitchen"] }, { roles: ["waiter"] }]);
    expect(rules).toEqual([{ role: "kitchen", min_on_shift: 2, orders_per_extra_staff: 8 }, DEFAULT_RULES.front]);
    expect(effectiveRules([], [{ roles: ["delivery"] }])).toEqual([DEFAULT_RULES.delivery]);
  });

  test("minimum plus one per X orders an hour", () => {
    expect(needFor({ role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 }, 0)).toBe(1);
    expect(needFor({ role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 }, 11.9)).toBe(1);
    expect(needFor({ role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 }, 12)).toBe(2);
    expect(needFor({ role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 }, 30)).toBe(3);
    expect(needFor({ role: "manager", min_on_shift: 0, orders_per_extra_staff: null }, 99)).toBe(0);
  });

  test("opening hours, split days, past midnight, special days", () => {
    expect(openSpans("12:00 – 22:00")).toEqual([{ start: 720, end: 1320 }]);
    expect(openSpans("12:00 – 15:00, 18:00 – 23:00")).toEqual([{ start: 720, end: 900 }, { start: 1080, end: 1380 }]);
    expect(openSpans("18:00 – 02:00")).toEqual([{ start: 1080, end: 1560 }]);
    expect(openSpans("Closed")).toEqual([]);
    expect(openingFor("2026-12-25", 5, { Friday: "12:00 – 23:00" }, { "2026-12-25": { hours: "Closed" } })).toEqual([]);
    expect(openingFor("2026-11-06", 5, { Friday: "12:00 – 23:00" }, null)).toEqual([{ start: 720, end: 1380 }]);
  });

  test("short times for WhatsApp: midnight is 24, past midnight wraps", () => {
    expect(shortSpan(720, 1320)).toBe("12–22");
    expect(shortSpan(1050, 1380)).toBe("17:30–23");
    expect(shortSpan(1200, 1440)).toBe("20–24");
    expect(shortSpan(1080, 1500)).toBe("18–1");
  });

  test("role words", () => {
    expect(roleKey("Front of House")).toBe("front");
    expect(roleKey("chef")).toBe("kitchen");
    expect(roleKey("rider")).toBe("delivery");
    expect(roleKey("barista")).toBe("barista");
  });
});
