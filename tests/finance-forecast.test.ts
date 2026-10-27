// The finance forecast (docs/pilot-sprint.md, "Finance forecast and calendar"):
// the history method and its back-test (lib/forecast/baseline.ts), the owner's
// wording for the week, labour against the target and last week
// (lib/finance/rules.ts), and the rota's labour cost (lib/finance/labour.ts).
import { describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { tkHistory } from "./support/tk-history";
import {
  averageOrderValue,
  backtest,
  BASELINE,
  baselineOrders,
  effectKind,
  historyWeeks,
  hourShares,
  learnEffects,
  normalOrders,
  quantile,
  rangesAllowed,
  type HistoryDay,
} from "@/lib/forecast/baseline";
import { dummyWeekAhead, weekTotals, type WeekAhead } from "@/lib/forecast/week-ahead-rules";
import { againstTarget, financeBlock, forecastLine, labourLine, lastWeekLines, lastWeekSummary, poundsShort, UPLOAD_TO_UNLOCK, type LabourWeek } from "@/lib/finance/rules";

const R = "7e57c0de-0000-4000-8000-000000000000";
const TODAY = "2026-10-26"; // a Monday
const history = (days: number, bump: Record<string, number> = {}): HistoryDay[] =>
  tkHistory(R, TODAY, days, bump).salesDays.map((d) => ({ day: d.day as string, orders: d.transactions as number, net_pence: Math.round((d.net_sales as number) * 100) }));
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("the history method", () => {
  test("whole weeks of history, and the 8-week threshold", () => {
    expect(historyWeeks(null, TODAY)).toBe(0);
    expect(historyWeeks(addDays(TODAY, -55), TODAY)).toBe(7);
    expect(historyWeeks(addDays(TODAY, -56), TODAY)).toBe(8);
    expect(BASELINE.minHistoryWeeks).toBe(8);
  });

  test("quantiles interpolate", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });

  test("a day's range from the same weekday in the 8 weeks before (at least 10% either side), never anything later", () => {
    const h = history(120);
    const sat = addDays(TODAY, 5);
    const r = baselineOrders(sat, TODAY, h)!;
    expect(r.low).toBeLessThanOrEqual(r.likely);
    expect(r.likely).toBeLessThanOrEqual(r.high);
    expect(r.likely).toBeGreaterThan(120);
    expect(r.low).toBeLessThanOrEqual(r.likely * 0.9 + 1e-9);
    expect(r.high).toBeGreaterThanOrEqual(r.likely * 1.1 - 1e-9);
    // A huge Saturday after asOf changes nothing.
    const later = [...h, { day: addDays(TODAY, -2 + 7), orders: 9999, net_pence: 1 }];
    expect(baselineOrders(sat, TODAY, later)).toEqual(r);
    // Fewer than 4 same weekdays: no forecast for that day.
    expect(baselineOrders(sat, TODAY, history(20))).toBeNull();
    expect(baselineOrders(sat, TODAY, h, 1.2)!.likely).toBeCloseTo(r.likely * 1.2);
    expect(normalOrders(sat, TODAY, h)).toBe(r.likely); // a normal day: the middle, no effects
  });

  test("average order value: net sales over orders, last 8 weeks, in pence", () => {
    expect(averageOrderValue([{ day: addDays(TODAY, -1), orders: 10, net_pence: 20_500 }, { day: addDays(TODAY, -2), orders: 30, net_pence: 59_500 }], TODAY)).toBe(2000);
    expect(averageOrderValue([{ day: addDays(TODAY, -70), orders: 10, net_pence: 20_000 }], TODAY)).toBeNull();
  });

  test("event effects are learnt from the restaurant's own past days (2+ times, 8%+)", () => {
    const sats = [2, 4, 6].map((w) => addDays(TODAY, -2 - 7 * w));
    const bumped = history(200, Object.fromEntries(sats.map((d) => [d, 1.25])));
    const effects = learnEffects(bumped, sats.map((d) => ({ date: d, kind: "sport" })));
    expect(effects.get("sport")!.multiplier).toBeGreaterThan(1.15);
    expect(effects.get("sport")!.times).toBe(3);
    // Once only: not enough. No real change: not counted.
    expect(learnEffects(bumped, [{ date: sats[0], kind: "sport" }]).size).toBe(0);
    expect(learnEffects(history(200), sats.map((d) => ({ date: d, kind: "sport" }))).size).toBe(0);
    expect(effectKind("religious", "Eid al-Fitr (expected)")).toBe("religious:eid");
    expect(effectKind("religious", "Ramadan")).toBe("religious:ramadan");
    expect(effectKind("sport", "West Ham v Fulham")).toBe("sport");
  });

  test("hours: each hour's share of that weekday's orders", () => {
    const shares = hourShares(
      [
        { day: "2026-10-24", hour: 12, orders: 10 },
        { day: "2026-10-24", hour: 19, orders: 30 },
        { day: "2026-10-23", hour: 19, orders: 99 }, // a Friday: not Saturday's
      ],
      6,
    );
    expect(shares).toEqual([{ hour: 12, share: 0.25 }, { hour: 19, share: 0.75 }]);
  });
});

describe("the back-test", () => {
  test("12 whole weeks, each knowing only the sales before its Monday; a steady pattern scores well", () => {
    const b = backtest(history(365), TODAY);
    expect(b.weeks).toBe(12);
    expect(b.days).toBe(84);
    expect(b.error_pct!).toBeLessThan(12);
    expect(b.range_hit_pct!).toBeGreaterThan(40);
    expect(b.by_week[0].week_start < b.by_week[11].week_start).toBe(true);
    expect(b.by_week.at(-1)!.week_start).toBe(addDays(TODAY, -7));
  });

  test("a wildly unsteady pattern scores badly, so its ranges would be held back", () => {
    const wild = history(365).map((h, i) => ({ ...h, orders: h.orders! * (i % 3 === 0 ? 3 : 1), net_pence: h.net_pence! * (i % 3 === 0 ? 3 : 1) }));
    const b = backtest(wild, TODAY);
    expect(b.error_pct!).toBeGreaterThan(BASELINE.defaultErrorLimitPct);
    expect(rangesAllowed(b.error_pct, null)).toBe(false);
  });

  test("too little history: nothing tested, nothing shown", () => {
    const b = backtest(history(20), TODAY); // under 4 of any weekday before every tested week
    expect(b).toMatchObject({ weeks: 0, error_pct: null });
    expect(rangesAllowed(b.error_pct, 20)).toBe(false);
  });

  test("the limit: at or under it shows, over it doesn't; the restaurant's own limit wins", () => {
    expect(rangesAllowed(20, null)).toBe(true);
    expect(rangesAllowed(20.1, null)).toBe(false);
    expect(rangesAllowed(20.1, 25)).toBe(true);
    expect(rangesAllowed(9, 8)).toBe(false);
  });
});

const week = (over: Partial<WeekAhead> = {}): WeekAhead => ({ ...dummyWeekAhead(R, TODAY), ...over });
const labour = (over: Partial<LabourWeek> = {}): LabourWeek => {
  const byDay = Object.fromEntries(week().days.map((d) => [d.date, 40_000]));
  return { status: "approved", costPence: 280_000, hours: 250, byDay, missingRates: 0, ...over };
};

describe("the owner's words", () => {
  test("money in short", () => {
    expect(poundsShort(95_000)).toBe("£950");
    expect(poundsShort(124_000)).toBe("£1,240");
    expect(poundsShort(1_424_900)).toBe("£14.2k");
  });

  test("the week's forecast: a range, or why not", () => {
    const w = week();
    const t = weekTotals(w.days)!;
    expect(forecastLine(w, "https://x/sales")).toBe(`Sales forecast ${poundsShort(t.low)}–${poundsShort(t.high)}, likely ${poundsShort(t.mid)} from about ${t.orders} orders`);
    expect(forecastLine(week({ status: "not_enough_history", show_ranges: false }), "https://x/sales")).toBe(`📈 ${UPLOAD_TO_UNLOCK}: https://x/sales`);
    expect(UPLOAD_TO_UNLOCK).toBe("Upload last year's sales to unlock forecasts");
    const held = forecastLine(week({ status: "held_back", show_ranges: false, accuracy: { method: "history_v1", error_pct: 26.4, range_hit_pct: 50, weeks: 12, limit_pct: 20 } }), "u")!;
    expect(held).toMatch(/held back: tested on your past weeks it was off by 26.4% on average, over the 20% limit/);
    expect(held).not.toMatch(/£/); // never a number it doesn't trust
  });

  test("labour: the rota's cost as a % of forecast sales, against the target", () => {
    const w = week();
    const sales = w.days.reduce((n, d) => n + d.sales_mid!, 0);
    const pct = Math.round((280_000 / sales) * 1000) / 10;
    expect(labourLine(labour(), w, 28)).toBe(`Rota £2,800 = ${pct}% of forecast sales · target 28% ✅`);
    expect(labourLine(labour({ status: "draft" }), w, 10)).toMatch(/^Draft rota £2,800 = [\d.]+% of forecast sales · target 10%: [\d.]+ points over ⚠️$/);
    expect(labourLine(labour(), w, null)).toMatch(/no target set \(text \*labour target 30%\* to set one\)/);
    expect(labourLine(labour({ status: "none" }), w, 28)).toBe("No rota for this week yet: text *ROTA* to see where it's up to.");
    expect(labourLine(labour(), week({ show_ranges: false, status: "held_back" }), 28)).toBe("Rota £2,800 (no forecast to compare it with)");
    expect(againstTarget(29, 28)).toEqual({ text: "target 28%: 1 point over ⚠️", over: true });
  });

  test("the brief's Monday block", () => {
    const text = financeBlock({ ahead: week(), labour: labour(), target: 28, uploadUrl: "u" })!;
    expect(text.split("\n")[0]).toBe("💷 *This week*");
    expect(text.split("\n")).toHaveLength(3);
    const none = financeBlock({ ahead: week({ status: "not_enough_history", show_ranges: false }), labour: labour({ status: "none" }), target: null, uploadUrl: "https://app.test/sales" });
    expect(none).toBe("💷 *This week*\n📈 Upload last year's sales to unlock forecasts: https://app.test/sales"); // no rota: no labour line
    expect(financeBlock({ ahead: week({ status: "past", show_ranges: false }), labour: labour({ status: "none" }), target: null, uploadUrl: "u" })).toBeNull();
  });

  test("last week: sales against what the forecast said, labour %, best and worst day", () => {
    const days = week().days.map((d, i) => ({ date: d.date, sales_low: d.sales_low, sales_mid: d.sales_mid, sales_high: d.sales_high, actual_pence: i === 1 ? d.sales_low! - 10_000 : d.sales_mid }));
    const s = lastWeekSummary(days, labour(), 28);
    expect(s.forecast!.inside).toBe(6);
    expect(s.best!.date).toBe(days[5].date); // Saturday
    expect(s.worst!.date).toBe(days[1].date);
    const lines = lastWeekLines(s, labour());
    expect(lines[0]).toMatch(/^Sales £[\d.,k]+: [\d.]+% below forecast \(£[\d.,k]+, range £[\d.,k]+–£[\d.,k]+\); 6 of 7 days inside their range\.$/);
    expect(lines[1]).toMatch(/^Labour £2,800 from the rota = [\d.]+% of sales · target 28% ✅$/);
    expect(lines[2]).toMatch(/^Best day: Saturday £[\d.,k]+ · worst: Tuesday £[\d.,k]+$/);
    expect(lastWeekLines(lastWeekSummary(days.map((d) => ({ ...d, actual_pence: null })), labour(), 28), labour())).toEqual(["No sales figures for last week yet."]);
  });
});

describe("the rota's labour cost", () => {
  const load = async (tables: Record<string, Record<string, unknown>[]>) => {
    vi.resetModules();
    const db = memoryDb(tables);
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    return import("@/lib/finance/labour");
  };

  test("the approved rota beats the draft; a suggester rota uses its own costs", async () => {
    const summary = { totals: { costPence: 123_456, hours: 99 }, days: [{ date: TODAY, costPence: 20_000 }] };
    const { labourForWeek } = await load({
      rota_weeks: [
        { id: "w1", restaurant_id: R, week_start: TODAY, status: "draft", summary: null, updated_at: "2026-10-25T10:00:00Z" },
        { id: "w2", restaurant_id: R, week_start: TODAY, status: "approved", summary, updated_at: "2026-10-24T10:00:00Z" },
        { id: "w3", restaurant_id: "other", week_start: TODAY, status: "approved", summary: { ...summary, totals: { costPence: 1, hours: 1 } }, updated_at: "2026-10-26T10:00:00Z" },
      ],
    });
    expect(await labourForWeek(R, TODAY)).toMatchObject({ status: "approved", costPence: 123_456, hours: 99, byDay: { [TODAY]: 20_000 } });
    expect((await labourForWeek(R, "2026-11-02")).status).toBe("none");
  });

  test("any other rota: its shifts x each person's rate that day; a shift with no rate is counted as missing", async () => {
    const { labourForWeek } = await load({
      rota_weeks: [{ id: "w1", restaurant_id: R, week_start: TODAY, status: "draft", summary: null, updated_at: "2026-10-25T10:00:00Z" }],
      rota_shifts: [
        { restaurant_id: R, rota_week_id: "w1", staff_id: "s1", role: "kitchen", business_date: TODAY, starts_at: "2026-10-26T12:00:00Z", ends_at: "2026-10-26T20:00:00Z", break_minutes: 30 },
        { restaurant_id: R, rota_week_id: "w1", staff_id: "s1", role: "kitchen", business_date: "2026-10-27", starts_at: "2026-10-27T12:00:00Z", ends_at: "2026-10-27T16:00:00Z", break_minutes: 0 },
        { restaurant_id: R, rota_week_id: "w1", staff_id: null, role: "front", business_date: TODAY, starts_at: "2026-10-26T12:00:00Z", ends_at: "2026-10-26T16:00:00Z", break_minutes: 0 },
      ],
      staff_pay_rates: [
        { restaurant_id: R, staff_id: "s1", hourly_pence: 1200, effective_from: "2026-01-01", recorded_at: "2026-01-01T00:00:00Z" },
        { restaurant_id: R, staff_id: "s1", hourly_pence: 1300, effective_from: "2026-10-27", recorded_at: "2026-10-20T00:00:00Z" },
      ],
    });
    const w = await labourForWeek(R, TODAY);
    expect(w.byDay[TODAY]).toBe(9000); // 7.5h x £12
    expect(w.byDay["2026-10-27"]).toBe(5200); // 4h x £13 (the new rate)
    expect(w).toMatchObject({ status: "draft", costPence: 14_200, hours: 15.5, missingRates: 1 });
  });
});
