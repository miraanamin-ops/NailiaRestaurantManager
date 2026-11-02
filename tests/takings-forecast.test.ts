// The forecast from takings alone (no order counts): the same weekday's net
// takings over the last 8 weeks, the recent trend, the time of year with a year of
// history, and event effects learnt from takings; order counts, when a day has
// them, still win (orders x average order value: sharper). Plain code
// (lib/forecast/baseline.ts), so no database.
import { describe, expect, test } from "vitest";
import { addDaysTo, backtest, baselineSales, dayRange, learnEffects, recentTrend, timeOfYear, type HistoryDay } from "@/lib/forecast/baseline";

const TODAY = "2026-11-02"; // a Monday
const WEEKDAY_PENCE = [80_000, 85_000, 90_000, 110_000, 160_000, 180_000, 120_000]; // Mon..Sun

// `days` of history up to yesterday: each weekday's usual takings, times scale(day).
function takingsOnly(days: number, scale: (day: string) => number = () => 1, orders = false): HistoryDay[] {
  const out: HistoryDay[] = [];
  for (let i = days; i >= 1; i--) {
    const day = addDaysTo(TODAY, -i);
    const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const net = Math.round(WEEKDAY_PENCE[wd] * scale(day));
    out.push({ day, net_pence: net, orders: orders ? Math.round(net / 2_000) : null });
  }
  return out;
}

describe("takings alone", () => {
  test("a steady restaurant: each weekday's usual takings, a range around it", () => {
    const h = takingsOnly(70);
    const fri = baselineSales("2026-11-06", TODAY, h)!;
    expect(fri.likely).toBe(160_000);
    expect(fri.low).toBeCloseTo(144_000); // never narrower than 10% either side
    expect(fri.high).toBeCloseTo(176_000);
    expect(dayRange("2026-11-06", TODAY, h, null)).toMatchObject({ method: "takings", orders: null });
  });

  test("too little history for a weekday: no forecast, never made up", () => {
    expect(baselineSales("2026-11-06", TODAY, takingsOnly(20))).toBeNull();
  });

  test("the recent trend: half of the change in the last 4 weeks, at most 10%", () => {
    const up6 = takingsOnly(70, (d) => (d >= addDaysTo(TODAY, -28) ? 1.06 : 1));
    expect(recentTrend(TODAY, up6)).toBeCloseTo(1.03, 2);
    const up40 = takingsOnly(70, (d) => (d >= addDaysTo(TODAY, -28) ? 1.4 : 1));
    expect(recentTrend(TODAY, up40)).toBeCloseTo(1.1);
    expect(recentTrend(TODAY, takingsOnly(30))).toBe(1); // not enough to tell
  });

  test("the time of year: last year's days around the date against its 8 weeks before, at most 25%", () => {
    // Last year, the days around this time were 20% busier than the 8 weeks before them.
    const lastYearNow = addDaysTo("2026-11-06", -364);
    const busy = (d: string) => (d >= addDaysTo(lastYearNow, -3) && d <= addDaysTo(lastYearNow, 3) ? 1.2 : 1);
    const h = takingsOnly(430, busy);
    expect(timeOfYear("2026-11-06", TODAY, h)).toBeCloseTo(1.2, 1);
    expect(baselineSales("2026-11-06", TODAY, h)!.likely).toBeCloseTo(160_000 * 1.2, -3);
    expect(timeOfYear("2026-11-06", TODAY, takingsOnly(70))).toBe(1); // under a year: none
  });

  test("order counts, when there, still decide (orders x average order value)", () => {
    const h = takingsOnly(70, () => 1, true);
    const r = dayRange("2026-11-06", TODAY, h, 2_000)!;
    expect(r.method).toBe("orders");
    expect(r.sales.likely).toBe(160_000);
  });

  test("event effects can be learnt from takings", () => {
    // Two past Fridays with a match were 30% up.
    const matchDays = ["2026-09-25", "2026-10-09"];
    const h = takingsOnly(120, (d) => (matchDays.includes(d) ? 1.3 : 1));
    const effects = learnEffects(h, matchDays.map((date) => ({ date, kind: "sport" })), "sales");
    expect(effects.get("sport")?.multiplier).toBeCloseTo(1.3);
    expect(learnEffects(h, matchDays.map((date) => ({ date, kind: "sport" }))).size).toBe(0); // no order counts to learn from
  });

  test("the back-test runs on takings alone too, so the ranges can be judged", () => {
    const t = backtest(takingsOnly(200), TODAY);
    expect(t.days).toBeGreaterThan(50);
    expect(t.error_pct).toBe(0);
    expect(t.range_hit_pct).toBe(100);
  });
});
