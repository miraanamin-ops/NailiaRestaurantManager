// The operations data's plain helpers: pence, units, "value on date", clock-change
// hours, "known at the time", reading a weather forecast, and the change planner's
// dish rename. No database.
import { describe, expect, test } from "vitest";
import { formatPence, percentOf, toPence, toPounds } from "@/lib/ops/money";
import { lineCostPence, parsePack, toStandard } from "@/lib/ops/units";
import { activeOn, onMenuOn, timeline, valueOn } from "@/lib/ops/history";
import { hoursInLondonDay, londonDayHour, londonHourSpan, londonHoursOf } from "@/lib/ops/hours";
import { eveningBefore, forecastForDay, forecastForHour, knownAt } from "@/lib/ops/known-at";
import { stripMenuIds } from "@/lib/ops/menu-ids";
import { forecastRows } from "@/lib/sales/weather-data";
import { planProfileChanges } from "@/lib/onboarding/profile-changes";

describe("pence", () => {
  test("pounds to whole pence without float errors", () => {
    expect(toPence(12.5)).toBe(1250);
    expect(toPence(0.1 + 0.2)).toBeNull(); // 0.30000000000000004 isn't a whole number of pence
    expect(toPence(19.99)).toBe(1999);
    expect(toPence(1.005)).toBeNull();
    expect(toPence("£1,234.56")).toBe(123456);
    expect(toPence("7.50")).toBe(750);
    expect(toPence("7.500")).toBe(750);
    expect(toPence("-5")).toBe(-500);
    expect(toPence("abc")).toBeNull();
    expect(toPence(null)).toBeNull();
    expect(toPence(14)).toBe(1400);
  });
  test("back to pounds and shown", () => {
    expect(toPounds(1250)).toBe(12.5);
    expect(formatPence(123456)).toBe("£1,234.56");
    expect(formatPence(5)).toBe("£0.05");
    expect(formatPence(-500)).toBe("-£5.00");
    expect(percentOf(2850, 10000)).toBe(28.5);
    expect(percentOf(1, 0)).toBeNull();
  });
});

describe("standard units", () => {
  test("invoice quantities become grams, millilitres or each", () => {
    expect(toStandard(5, "kg")).toEqual({ quantity: 5000, unit: "g" });
    expect(toStandard(1.5, "L")).toEqual({ quantity: 1500, unit: "ml" });
    expect(toStandard(70, "cl")).toEqual({ quantity: 700, unit: "ml" });
    expect(toStandard(2, "lb")).toEqual({ quantity: 907.184, unit: "g" });
    expect(toStandard(1, "furlong")).toBeNull();
    expect(parsePack("5kg")).toEqual({ quantity: 5000, unit: "g" });
    expect(parsePack("2 x 1L")).toEqual({ quantity: 2000, unit: "ml" });
    expect(parsePack("12x400g")).toEqual({ quantity: 4800, unit: "g" });
    expect(parsePack("case of 24")).toEqual({ quantity: 24, unit: "each" });
    expect(parsePack("30")).toEqual({ quantity: 30, unit: "each" });
    expect(parsePack("a big bag")).toBeNull();
  });
  test("a recipe line's cost allows for waste", () => {
    // 180 g at £12.50 per 1000 g, 10% trimmed: 200 g bought = 250p.
    expect(lineCostPence(180, 1250, 1000, 10)).toBeCloseTo(250, 6);
    expect(lineCostPence(1, 100, 0)).toBeNull();
  });
});

describe("value on a date", () => {
  const prices = [
    { effective_from: "2026-01-01", recorded_at: "2026-01-01T09:00:00Z", price: 1200 },
    { effective_from: "2026-06-01", recorded_at: "2026-05-20T09:00:00Z", price: 1350 },
    // A correction for the same day, recorded later: it wins from then on.
    { effective_from: "2026-06-01", recorded_at: "2026-06-03T09:00:00Z", price: 1395 },
  ];
  test("the latest effective_from on or before the day", () => {
    expect(valueOn(prices, "2025-12-31")).toBeNull();
    expect(valueOn(prices, "2026-01-01")?.price).toBe(1200);
    expect(valueOn(prices, "2026-05-31")?.price).toBe(1200);
    expect(valueOn(prices, "2026-06-01")?.price).toBe(1395);
    expect(valueOn(prices, "2026-12-01")?.price).toBe(1395);
  });
  test("as known at a moment: later corrections are ignored", () => {
    expect(valueOn(prices, "2026-06-02", { knownAt: "2026-06-02T00:00:00Z" })?.price).toBe(1350);
    expect(valueOn(prices, "2026-06-02", { knownAt: "2026-05-01T00:00:00Z" })?.price).toBe(1200);
    expect(valueOn(prices, "2026-06-02", { knownAt: new Date("2025-01-01") })).toBeNull();
  });
  test("timeline: the value in force from each change", () => {
    expect(timeline(prices).map((r) => r.price)).toEqual([1200, 1395]);
    expect(timeline(prices, { knownAt: "2026-06-02T00:00:00Z" }).map((r) => r.price)).toEqual([1200, 1350]);
  });
  test("spans: effective_to is the first day it no longer applies", () => {
    const rows = [
      { effective_from: "2026-01-01", effective_to: "2026-03-01", n: 1 },
      { effective_from: "2026-02-01", effective_to: null, n: 2 },
    ];
    expect(activeOn(rows, "2026-01-15").map((r) => r.n)).toEqual([1]);
    expect(activeOn(rows, "2026-02-15").map((r) => r.n)).toEqual([1, 2]);
    expect(activeOn(rows, "2026-03-01").map((r) => r.n)).toEqual([2]);
    expect(onMenuOn({ active_from: "2026-01-01", active_to: "2026-02-01" }, "2026-01-31")).toBe(true);
    expect(onMenuOn({ active_from: "2026-01-01", active_to: "2026-02-01" }, "2026-02-01")).toBe(false);
  });
});

describe("London hours across the clock changes", () => {
  test("a normal day has 24 hours, March 29 2026 has 23, October 25 2026 has 25", () => {
    expect(hoursInLondonDay("2026-07-01")).toBe(24);
    expect(hoursInLondonDay("2026-03-29")).toBe(23);
    expect(hoursInLondonDay("2026-10-25")).toBe(25);
  });
  test("October: 01:00 happens twice (BST then GMT), in order", () => {
    const hours = londonHoursOf("2026-10-25");
    expect(hours.map((h) => h.hour).slice(0, 4)).toEqual([0, 1, 1, 2]);
    expect(hours[1].start.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(hours[2].start.toISOString()).toBe("2026-10-25T01:00:00.000Z");
    expect(londonHourSpan("2026-10-25", 1)).toEqual({ start: new Date("2026-10-25T00:00:00Z"), minutes: 120 });
  });
  test("March: 01:00 doesn't happen", () => {
    const hours = londonHoursOf("2026-03-29");
    expect(hours.map((h) => h.hour).slice(0, 3)).toEqual([0, 2, 3]);
    expect(londonHourSpan("2026-03-29", 1).minutes).toBe(0);
    expect(londonHourSpan("2026-03-29", 2)).toEqual({ start: new Date("2026-03-29T01:00:00Z"), minutes: 60 });
  });
  test("a UTC moment's London day and hour", () => {
    expect(londonDayHour(new Date("2026-07-01T23:30:00Z"))).toEqual({ day: "2026-07-02", hour: 0 });
    expect(londonDayHour(new Date("2026-12-01T23:30:00Z"))).toEqual({ day: "2026-12-01", hour: 23 });
  });
});

describe("what was known at the time", () => {
  const rows = [
    { issued_at: "2026-10-10T06:00:00Z", target_day: "2026-10-12", hour_start: null, rain: 5 },
    { issued_at: "2026-10-11T06:00:00Z", target_day: "2026-10-12", hour_start: null, rain: 2 },
    { issued_at: "2026-10-12T06:00:00Z", target_day: "2026-10-12", hour_start: null, rain: 0 }, // issued on the day: too late
    { issued_at: "2026-10-11T06:00:00Z", target_day: null, hour_start: "2026-10-12T18:00:00Z", rain: 1 },
  ];
  test("never a forecast issued after the cut-off", () => {
    const cutoff = eveningBefore("2026-10-12");
    expect(cutoff.toISOString()).toBe("2026-10-11T17:00:00.000Z"); // 18:00 BST
    expect(forecastForDay(rows, "2026-10-12", cutoff)?.rain).toBe(2);
    expect(forecastForDay(rows, "2026-10-12", "2026-10-10T12:00:00Z")?.rain).toBe(5);
    expect(forecastForDay(rows, "2026-10-12", "2026-10-09T00:00:00Z")).toBeNull();
    expect(forecastForHour(rows, "2026-10-12T18:00:00Z", cutoff)?.rain).toBe(1);
    expect(forecastForHour(rows, "2026-10-12T18:00:00Z", "2026-10-11T05:59:59Z")).toBeNull();
    // Whatever the cut-off, nothing issued after it comes back.
    for (const hours of [0, 6, 12, 30, 48, 60]) {
      const cut = new Date(Date.UTC(2026, 9, 10, hours));
      const got = knownAt(rows, cut);
      if (got) expect(new Date(got.issued_at).getTime()).toBeLessThanOrEqual(cut.getTime());
    }
    expect(eveningBefore("2026-12-02").toISOString()).toBe("2026-12-01T18:00:00.000Z"); // 18:00 GMT
  });
});

describe("reading an Open-Meteo forecast", () => {
  test("days from today and hours from now are the forecast; earlier hours are actuals", () => {
    const at = (iso: string) => new Date(iso).getTime() / 1000;
    const json = {
      daily: {
        time: [at("2026-10-15T23:00:00Z"), at("2026-10-16T23:00:00Z"), at("2026-10-17T23:00:00Z")], // London midnights
        temperature_2m_max: [14.23, 15, 16],
        temperature_2m_min: [8, 9, 10],
        precipitation_sum: [0, 2.04, null],
        precipitation_probability_max: [10, 80, 40],
        weather_code: [3, 61, 2],
      },
      hourly: {
        time: [at("2026-10-17T10:00:00Z"), at("2026-10-17T11:00:00Z"), at("2026-10-17T12:00:00Z")],
        temperature_2m: [12, 13, 14],
        precipitation: [0, 0.2, 0],
        precipitation_probability: [5, 30, 10],
        weather_code: [1, 51, 2],
        cloud_cover: [20, 90, 50],
        wind_speed_10m: [10, 12, 11],
      },
    };
    const out = forecastRows(json, new Date("2026-10-17T11:20:00Z"));
    expect(out.days.map((d) => d.target_day)).toEqual(["2026-10-17", "2026-10-18"]); // the 16th is past
    expect(out.days[0]).toMatchObject({ temp_max: 15, rain_mm: 2, rain_chance: 80, weather_code: 61 });
    expect(out.hours.map((h) => h.hour_start)).toEqual(["2026-10-17T11:00:00.000Z", "2026-10-17T12:00:00.000Z"]);
    expect(out.past).toEqual([{ hour_start: "2026-10-17T10:00:00.000Z", temp: 12, rain_mm: 0, weather_code: 1, cloud_pct: 20, wind_kmh: 10 }]);
  });
});

describe("menu ids and renames by message", () => {
  test("ids never reach the saved copy or the log", () => {
    expect(stripMenuIds([{ id: "s1", category: "Mains", items: [{ id: "d1", name: "Kebab", price: 9, description: null }] }])).toEqual([
      { category: "Mains", items: [{ name: "Kebab", price: 9, description: null }] },
    ]);
  });
  const current = {
    opening_hours: {},
    menu: [{ category: "Mains", items: [{ name: "Chicken Tikka", price: 11, description: null }, { name: "Lamb Chops", price: 14, description: null }] }],
    signup_reward: null,
    discount_cap_percent: 20,
    phone: null,
    address: null,
    website: null,
  };
  test("rename_dish renames in place and says which dish is which", () => {
    const plan = planProfileChanges(current, [{ change: "rename_dish", name: "chicken tikka", value: "Chicken Tikka Masala" }]);
    expect(plan.lines).toEqual(["Renamed Chicken Tikka to Chicken Tikka Masala"]);
    expect(plan.renames).toEqual([{ from: "Chicken Tikka", to: "Chicken Tikka Masala" }]);
    expect(plan.fields.menu?.[0].items.map((i) => [i.name, i.price])).toEqual([["Chicken Tikka Masala", 11], ["Lamb Chops", 14]]);
  });
  test("a rename to a name already on the menu, or of a dish that isn't there, is asked about", () => {
    expect(planProfileChanges(current, [{ change: "rename_dish", name: "Chicken Tikka", value: "lamb chops" }]).problems).toEqual(["There's already a Lamb Chops on your menu."]);
    expect(planProfileChanges(current, [{ change: "rename_dish", name: "Biryani", value: "Veg Biryani" }]).problems).toEqual([`I couldn't find "Biryani" on your menu.`]);
    expect(planProfileChanges(current, [{ change: "rename_dish", name: "Lamb Chops" }]).problems).toEqual(["What should Lamb Chops be called?"]);
  });
});
