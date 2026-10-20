// Slice 1, the forecast shown to owners (src/lib/forecast/): the pure rules
// (rounding, which run, reasons, flags, the offer, every line's wording), the
// demo-only override, the brief's forecast block built against an in-memory
// database that applies every filter, both brief paths showing the same block,
// the quiet-night offer tap, and the assistant's number check.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { FACTOR_WORDS, factorWords } from "@/lib/forecast/factors";
import { runAccess, unvalidatedForecastsAllowed } from "@/lib/forecast/access";
import {
  channelsToShow,
  composeForecastBlock,
  coversRecorded,
  daysAheadFlags,
  dayName,
  forecastWeek,
  mentionsStaffing,
  noForecastReason,
  normalDay,
  numbersOnlyFrom,
  offerBlockedLine,
  offerDay,
  offerQuestion,
  offerRequest,
  reasonsFor,
  roundCount,
  roundSales,
  showFootnote,
  usableRuns,
  yesterdayLine,
  type Flag,
  type RunInfo,
} from "@/lib/forecast/rules";
import { looksLikeForecastQuestion, parseCommand, parseOfferTap } from "@/lib/bot/parse";

const R = "11111111-1111-1111-1111-111111111111";
// Every module a test below replaces; put back after each test so they never leak into the next.
const MOCKED = ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/campaigns", "@/lib/audit", "@/lib/forecast", "@/lib/notify", "@/lib/feedback", "@/lib/sales/z-reports", "@/lib/agents/gm", "@/lib/agents/jobs", "@/lib/assistant", "@/lib/bot/flows", "@/lib/drafts", "@/lib/agents/growth"];
afterEach(() => {
  for (const m of MOCKED) vi.doUnmock(m);
  vi.unstubAllEnvs();
});
const OTHER = "22222222-2222-2222-2222-222222222222";
const TODAY = "2026-10-20"; // a Tuesday
const NOW = new Date("2026-10-20T08:00:00Z"); // 09:00 in London (BST)

// ---------- Every factor the model can emit has owner words ----------

describe("the driver dictionary", () => {
  const MODEL = "analytics/service/src/dinerai_analytics/models/forecast_daily";
  const tuple = (file: string, name: string) => {
    const src = readFileSync(`${MODEL}/${file}`, "utf8");
    const m = src.match(new RegExp(`${name} = \\(([\\s\\S]*?)\\)\\r?\\n`));
    if (!m) throw new Error(`${name} not found in ${file}`);
    return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
  };

  test("every factor the model can write to forecast_drivers has an entry (or is never a reason)", () => {
    const sports = tuple("events.py", "SPORTS");
    const events = readFileSync(`${MODEL}/events.py`, "utf8");
    expect(events).toMatch(/SPORT_FACTORS = tuple\(f"\{s\}_\{w\}" for s in SPORTS for w in \("during", "after"\)\)/);
    const emitted = [
      ...tuple("calendar_factors.py", "CALENDAR_FACTORS"),
      ...tuple("calendar_factors.py", "RELIGIOUS_FACTORS"),
      ...tuple("weather.py", "WEATHER_FACTORS"),
      ...sports.flatMap((s) => [`${s}_during`, `${s}_after`]),
      ...[...events.matchAll(/EVENT_FACTORS = \(\*SPORT_FACTORS, ([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])),
    ];
    // The grouped items forecast.contributions writes (weekday and season as one each, prices, hours open).
    const contributions = readFileSync(`${MODEL}/forecast.py`, "utf8");
    const grouped = [...contributions.matchAll(/c\["([a-z_]+)"\]/g)].map((m) => m[1]);
    expect(grouped).toEqual(expect.arrayContaining(["weekday", "season", "prices", "hours_open"]));
    expect(emitted.length).toBeGreaterThan(30);
    const missing = [...emitted, ...grouped].filter((f) => !(f in FACTOR_WORDS));
    expect(missing).toEqual([]);
    // Deals are named from the campaign.
    expect(contributions + readFileSync(`${MODEL}/design.py`, "utf8")).toContain('f"deal:{');
    expect(factorWords("deal:abc", { today: true, multiplier: 1.2, dealName: "Quiet Thursday" })).toBe('your "Quiet Thursday" offer');
  });

  test("weekday and season are never reasons; the wording follows the day", () => {
    expect(FACTOR_WORDS.weekday).toBeNull();
    expect(FACTOR_WORDS.season).toBeNull();
    expect(factorWords("eid_fitr_d1", { today: true, multiplier: 1.8 })).toBe("Eid");
    expect(factorWords("rain_dinner", { today: true, multiplier: 0.9 })).toBe("rain this evening");
    expect(factorWords("rain_dinner", { today: false, multiplier: 0.9 })).toBe("rain in the evening");
    expect(factorWords("hours_open", { today: true, multiplier: 0.8 })).toBe("shorter opening hours");
    expect(factorWords("something_new", { today: true, multiplier: 2 })).toBeUndefined();
  });

  test("no em-dashes in anything an owner reads", () => {
    for (const f of ["factors.ts", "rules.ts", "index.ts", "offer.ts", "access.ts"]) expect(readFileSync(`src/lib/forecast/${f}`, "utf8")).not.toContain(String.fromCharCode(0x2014));
  });
});

// ---------- Rounding ----------

describe("rounding (always outward)", () => {
  test("orders to the nearest 5", () => {
    expect(roundCount({ low: 97, likely: 111, high: 123 })).toEqual({ low: 95, likely: 110, high: 125 });
    expect(roundCount({ low: 95, likely: 95, high: 95 })).toEqual({ low: 95, likely: 95, high: 95 });
    expect(roundCount({ low: 2, likely: 3, high: 4 })).toEqual({ low: 0, likely: 5, high: 5 });
  });
  test("sales: £10 steps under £1,000 and £50 from £1,000 (pence in and out)", () => {
    expect(roundSales({ low: 84_123, likely: 91_789, high: 99_801 })).toEqual({ low: 84_000, likely: 92_000, high: 100_000 });
    expect(roundSales({ low: 145_400, likely: 164_900, high: 190_100 })).toEqual({ low: 145_000, likely: 165_000, high: 195_000 });
  });
});

// ---------- Which run ----------

const run = (id: string, model: string, extra: Partial<RunInfo> = {}): RunInfo => ({
  id,
  model_name: model,
  role: "production",
  status: "succeeded",
  passed: true,
  started_at: model === "forecast_refresh" ? "2026-10-20T06:00:00Z" : "2026-10-20T04:35:00Z",
  metrics: {},
  ...extra,
});

describe("which run the brief uses", () => {
  test("the 07:00 refresh when it passed, else the 05:35 run", () => {
    expect(usableRuns([run("d", "forecast_daily"), run("f", "forecast_refresh")], false).map((u) => u.run.id)).toEqual(["f", "d"]);
    expect(usableRuns([run("d", "forecast_daily"), run("f", "forecast_refresh", { status: "failed" })], false).map((u) => u.run.id)).toEqual(["d"]);
  });
  test("nothing that didn't pass, and never a benchmark, unless the override (then labelled TEST, benchmarks still never)", () => {
    const runs = [run("d", "forecast_daily", { passed: false }), run("b", "forecast_daily", { role: "benchmark" })];
    expect(usableRuns(runs, false)).toEqual([]);
    expect(usableRuns(runs, true)).toEqual([{ run: runs[0], unvalidated: true }]);
    expect(usableRuns([run("x", "forecast_baseline")], true)).toEqual([]);
  });
  test("why there's no forecast (for the builder)", () => {
    expect(noForecastReason([])).toContain("no forecast run today");
    expect(noForecastReason([run("d", "forecast_daily", { status: "failed" })])).toBe("the 05:35 run failed");
    const failed = { pass: { checks: [{ check: "orders/all 80% range coverage", ok: false }, { check: "history", ok: true }] } };
    expect(noForecastReason([run("d", "forecast_daily", { passed: false, metrics: failed })])).toBe("the 05:35 run didn't pass its back-test: orders/all 80% range coverage");
  });
});

describe("the demo-only override", () => {
  const on = { TEST_TOOLS: "true" };
  test("only with TEST_TOOLS on, a demo restaurant and its setting on", () => {
    expect(unvalidatedForecastsAllowed(on, { is_demo: true, forecast_unvalidated: true })).toBe(true);
    expect(unvalidatedForecastsAllowed({}, { is_demo: true, forecast_unvalidated: true })).toBe(false);
    expect(unvalidatedForecastsAllowed(on, { is_demo: true, forecast_unvalidated: false })).toBe(false);
  });
  test("never for a real restaurant, whatever the switches and the setting say", () => {
    for (const env of [on, { TEST_TOOLS: "true", TEST_MODE: "true" }, {}]) {
      expect(unvalidatedForecastsAllowed(env, { is_demo: false, forecast_unvalidated: true })).toBe(false);
      expect(unvalidatedForecastsAllowed(env, { is_demo: null, forecast_unvalidated: true })).toBe(false);
      expect(unvalidatedForecastsAllowed(env, null)).toBe(false);
    }
  });
  test("a run's outputs: passed ones always, unvalidated only with the override, benchmarks and failures never", () => {
    expect(runAccess({ role: "production", status: "succeeded", passed: true }, false)).toEqual({ ok: true, unvalidated: false });
    expect(runAccess({ role: "production", status: "succeeded", passed: false }, false).ok).toBe(false);
    expect(runAccess({ role: "production", status: "succeeded", passed: false }, true)).toEqual({ ok: true, unvalidated: true });
    expect(runAccess({ role: "benchmark", status: "succeeded", passed: true }, true).ok).toBe(false);
    expect(runAccess({ role: "production", status: "failed", passed: true }, true).ok).toBe(false);
  });
});

// ---------- Channels and covers ----------

describe("channel and covers lines", () => {
  const metrics = {
    pass: {
      deciding_channels: ["all", "delivery", "dine_in"],
      checks: [
        { check: "orders/delivery days scored", ok: true },
        { check: "orders/delivery WAPE vs baseline", ok: true },
        { check: "orders/dine_in WAPE vs baseline", ok: false },
      ],
    },
  };
  test("only a channel the model counted (15% or more of orders) whose own checks all passed", () => {
    expect(channelsToShow(metrics)).toEqual(["delivery"]);
    expect(channelsToShow({})).toEqual([]);
    expect(channelsToShow(null)).toEqual([]);
  });
  test("covers only when recorded on 20 of the last 28 days", () => {
    const days = (n: number) => Array.from({ length: 28 }, (_, i) => ({ day: `2026-09-${String(22 + (i % 9)).padStart(2, "0")}`, covers: i < n ? 50 : null }));
    const recent = (n: number) => Array.from({ length: 28 }, (_, i) => ({ day: addDay(TODAY, -(i + 1)), covers: i < n ? 50 : null }));
    expect(coversRecorded(recent(20), TODAY)).toBe(true);
    expect(coversRecorded(recent(19), TODAY)).toBe(false);
    expect(coversRecorded(days(0), TODAY)).toBe(false);
  });
});

function addDay(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- Reasons, normal days and flags ----------

describe("reasons", () => {
  test("the top 3 in owner words with their effect; weekday, season and tiny effects left out", () => {
    const reasons = reasonsFor(
      [
        { factor: "weekday", multiplier: 1.4 },
        { factor: "season", multiplier: 0.8 },
        { factor: "school_holiday", multiplier: 1.08 },
        { factor: "rain_dinner", multiplier: 0.94 },
        { factor: "sunshine", multiplier: 1.02 },
        { factor: "payday_window", multiplier: 1.05 },
        { factor: "temp_cold", multiplier: 0.965 },
      ],
      { today: true },
    );
    expect(reasons.map((r) => `${r.words} ${r.pct}`)).toEqual(["school holidays 8", "rain this evening -6", "payday 5"]);
  });
});

describe("a normal day and the days-ahead flags", () => {
  const history = Array.from({ length: 70 }, (_, i) => ({ day: addDay(TODAY, -(i + 1)), orders: 100 }));
  test("the median of the last 8 same weekdays, leaving out unusual and closed days", () => {
    const h = history.map((d) => (d.day === "2026-10-16" ? { ...d, orders: 400 } : d.day === "2026-10-09" ? { ...d, orders: 0 } : d));
    expect(normalDay("2026-10-23", TODAY, h, new Set(["2026-10-16"]))).toBe(100);
    expect(normalDay("2026-10-23", TODAY, history.slice(0, 20), new Set())).toBe(null); // only 2 Fridays
  });
  test("quiet at 20% below, busy at 20% above; at most 2, with the main reason pointing the right way", () => {
    const normals = new Map([
      ["2026-10-21", 100],
      ["2026-10-22", 100],
      ["2026-10-23", 100],
      ["2026-10-24", 100],
      ["2026-10-25", 100],
    ]);
    const flags = daysAheadFlags(
      TODAY,
      [
        { day: "2026-10-21", likely: 81, reasons: [] }, // -19%: not flagged
        { day: "2026-10-22", likely: 120, reasons: [] }, // +20%: busy
        { day: "2026-10-23", likely: 70, reasons: [{ factor: "eid_fitr_d1", words: "Eid", pct: 10 }, { factor: "rain_dinner", words: "rain in the evening", pct: -12 }] },
        { day: "2026-10-24", likely: 135, reasons: [{ factor: "eid_fitr_d1", words: "Eid", pct: 30 }] },
        { day: "2026-10-25", likely: 79, reasons: [] }, // -21%: smaller than the two biggest
      ],
      normals,
    );
    expect(flags.map((f) => [f.day, f.kind, f.pct, f.reason])).toEqual([
      ["2026-10-23", "quiet", -30, "rain in the evening"],
      ["2026-10-24", "busy", 35, "Eid"],
    ]);
  });
  test("day names", () => {
    expect(dayName(1, "2026-10-21")).toBe("Tomorrow");
    expect(dayName(3, "2026-10-23")).toBe("Friday");
    expect(dayName(7, "2026-10-27")).toBe("Next Tuesday");
  });
});

// ---------- The offer ----------

const quietFri: Flag = { day: "2026-10-23", offset: 3, kind: "quiet", pct: -30, likely: 70, normal: 100, reason: "rain in the evening" };

describe("the quiet-night offer", () => {
  test("only for a quiet day 3 to 7 days ahead", () => {
    expect(offerDay([quietFri])).toEqual(quietFri);
    expect(offerDay([{ ...quietFri, offset: 2 }])).toBeNull();
    expect(offerDay([{ ...quietFri, offset: 8 }])).toBeNull();
    expect(offerDay([{ ...quietFri, kind: "busy", pct: 30 }])).toBeNull();
  });
  test("the question, the 7-day gap line and the campaign request carry code's numbers", () => {
    expect(offerQuestion(quietFri)).toBe(
      "📉 Friday 23 Oct looks quiet: likely about 70 orders, against about 100 on a normal Friday. Shall I draft an offer email for that day? You'll see it before anything goes out.",
    );
    expect(offerBlockedLine(quietFri, "2026-10-19")).toBe("Everyone on your list had an offer email on Mon 19 Oct, and nobody gets more than one a week, so I can't send one for Friday.");
    expect(offerBlockedLine(quietFri, null)).toContain("in the last 7 days");
    const req = offerRequest(quietFri);
    expect(req).toContain("about 70 orders, against about 100 on a normal Friday (about 30% fewer), mainly rain in the evening");
    expect(req).toContain("valid_from and valid_until both 2026-10-23");
  });
});

// ---------- Yesterday and the block ----------

describe("the brief's forecast block", () => {
  test("yesterday against the range yesterday's brief showed", () => {
    const shown = { orders_low: 90, orders_high: 120 };
    expect(yesterdayLine(shown, 104)).toBe("Yesterday: 104 orders, inside the forecast (90 to 120) ✓");
    expect(yesterdayLine(shown, 131)).toBe("Yesterday: 131 orders, above the forecast (90 to 120)");
    expect(yesterdayLine(shown, 80)).toBe("Yesterday: 80 orders, below the forecast (90 to 120)");
    expect(yesterdayLine(shown, null)).toBeNull();
    expect(yesterdayLine(null, 104)).toBeNull();
  });

  const base = {
    status: "shown" as const,
    today: TODAY,
    unvalidated: false,
    orders: { low: 95, likely: 110, high: 125 },
    sales: { low: 145_000, likely: 165_000, high: 190_000 },
    channels: [],
    covers: null,
    reasons: [
      { factor: "school_holiday", words: "half-term", pct: 8 },
      { factor: "rain_dinner", words: "rain this evening", pct: -6 },
    ],
    yesterday: "Yesterday: 104 orders, inside the forecast (90 to 120) ✓",
    flags: [],
    blockedOffer: null,
    footnote: false,
  };

  test("a normal day reads exactly as agreed", () => {
    expect(composeForecastBlock(base)).toBe(
      [
        "📈 *Today, Tue 20 Oct:* likely 110 orders (95 to 125), about £1,650 before VAT",
        "Why: half-term (+8%), rain this evening (-6%)",
        "Yesterday: 104 orders, inside the forecast (90 to 120) ✓",
      ].join("\n"),
    );
  });
  test("channel, covers, days ahead, the gap line and the footnote only when given", () => {
    const block = composeForecastBlock({
      ...base,
      channels: [{ channel: "delivery", range: { low: 30, likely: 40, high: 45 } }],
      covers: { low: 60, likely: 70, high: 85 },
      flags: [{ ...quietFri }],
      blockedOffer: offerBlockedLine(quietFri, "2026-10-19"),
      footnote: true,
    })!;
    expect(block.split("\n")).toEqual([
      "📈 *Today, Tue 20 Oct:* likely 110 orders (95 to 125), about £1,650 before VAT",
      "Delivery: likely 40 orders (30 to 45)",
      "Covers: likely 70 (60 to 85)",
      "Why: half-term (+8%), rain this evening (-6%)",
      "Yesterday: 104 orders, inside the forecast (90 to 120) ✓",
      "Days ahead: Friday looks about 30% quieter than a normal Friday, mainly rain in the evening.",
      "Everyone on your list had an offer email on Mon 19 Oct, and nobody gets more than one a week, so I can't send one for Friday.",
      "_Forecasts are information, not financial advice._",
    ]);
  });
  test("TEST label, no forecast today, and nothing at all", () => {
    expect(composeForecastBlock({ ...base, unvalidated: true })).toContain("📈 *Today, Tue 20 Oct (TEST: unvalidated forecast):*");
    expect(composeForecastBlock({ ...base, status: "no_forecast" })).toBe("📈 No forecast today.");
    expect(composeForecastBlock({ ...base, status: "none" })).toBeNull();
  });
  test("the footnote: the first brief with a forecast, then Mondays", () => {
    expect(showFootnote({ shownBefore: false, londonWeekday: 2 })).toBe(true);
    expect(showFootnote({ shownBefore: true, londonWeekday: 2 })).toBe(false);
    expect(showFootnote({ shownBefore: true, londonWeekday: 1 })).toBe(true);
  });
});

// ---------- The assistant ----------

describe("the assistant's forecast answers", () => {
  const lines = ["Saturday 24 Oct: likely 135 orders (120 to 150), about £2,100 before VAT, about 35% busier than a normal Saturday; why: Eid (+30%)"];
  test("every number must be one look_up_forecast gave", () => {
    expect(numbersOnlyFrom("Saturday 24 Oct looks busy: likely 135 orders (120 to 150), mainly Eid (+30%).", lines)).toBe(true);
    expect(numbersOnlyFrom("Saturday should bring around 140 orders.", lines)).toBe(false);
    expect(numbersOnlyFrom("Expect about £2,500 on Saturday.", lines)).toBe(false);
  });
  test("no staffing talk", () => {
    expect(mentionsStaffing("Saturday looks busy, so you might want an extra shift on the rota.")).toBe(true);
    expect(mentionsStaffing("Saturday looks about 35% busier, mainly Eid.")).toBe(false);
  });
  test("a failing answer is replaced by code's lines, with the TEST label and the short footnote", async () => {
    const { forecastAnswer } = await import("@/lib/assistant");
    const good = forecastAnswer("Saturday 24 Oct: likely 135 orders (120 to 150).", [{ lines, unvalidated: false }]);
    expect(good).toBe("Saturday 24 Oct: likely 135 orders (120 to 150).\n\n_Forecast: information, not financial advice._");
    const bad = forecastAnswer("Around 140 orders, so add a shift.", [{ lines, unvalidated: true }]);
    expect(bad).toBe(`(TEST: unvalidated forecast)\n${lines[0]}\n\n_Forecast: information, not financial advice._`);
  });
  test("forecast questions are spotted; a request for an offer isn't one", () => {
    for (const q of ["How busy will Saturday be?", "why is Friday quiet?", "What's the forecast for tomorrow?", "will tonight be busy"]) expect(looksLikeForecastQuestion(q), q).toBe(true);
    for (const q of ["Thursday is quiet", "Thursday is always quiet, do an offer", "how busy was yesterday?", "thanks!"]) expect(looksLikeForecastQuestion(q), q).toBe(false);
  });
  test("the offer buttons and typed answers, and the test command", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    expect(parseOfferTap(`quietoffer:${id}`, "Draft an offer")).toEqual({ yes: true, id });
    expect(parseOfferTap(`noquiet:${id}`, "Not now")).toEqual({ yes: false, id });
    expect(parseOfferTap(undefined, "DRAFT OFFER")).toEqual({ yes: true });
    expect(parseOfferTap(undefined, "no offer")).toEqual({ yes: false });
    expect(parseOfferTap(undefined, "not now")).toBeNull();
    expect(parseCommand("TEST FORECAST ON", 2)).toEqual({ name: "test_forecast", on: true });
    expect(parseCommand("test forecast off", 2)).toEqual({ name: "test_forecast", on: false });
  });
});

describe("the Monday report", () => {
  test("each day's orders against its range, and how many landed inside", () => {
    const w = forecastWeek([
      { day: "2026-10-12", low: 90, high: 120, actual: 104 },
      { day: "2026-10-13", low: 90, high: 120, actual: 131 },
      { day: "2026-10-14", low: 90, high: 120, actual: 90 },
    ]);
    expect(w.inside).toBe(2);
    expect(w.total).toBe(3);
    expect(w.rows.map((r) => r.inside)).toEqual([true, false, true]);
  });
});

// ---------- The brief's block, against an in-memory database ----------

type Seed = Record<string, Record<string, unknown>[]>;

const DAILY = "aaaaaaaa-0000-0000-0000-000000000001";
const REFRESH = "aaaaaaaa-0000-0000-0000-000000000002";
const PASS_METRICS = { pass: { deciding_channels: ["all"], checks: [{ check: "orders/all bias", ok: true }] } };

const fc = (runId: string, day: string, metric: string, low: number, likely: number, high: number, channel = "all") => ({
  id: `${runId}-${day}-${metric}-${channel}`,
  restaurant_id: R,
  model_run_id: runId,
  target_day: day,
  hour_start: null,
  local_hour: null,
  metric,
  channel,
  low,
  likely,
  high,
  issued_at: runId === REFRESH ? "2026-10-20T06:00:00Z" : "2026-10-20T04:35:00Z",
});
const drv = (runId: string, day: string, factor: string, multiplier: number) => ({ id: `${runId}-${day}-${factor}`, restaurant_id: R, model_run_id: runId, target_day: day, channel: "all", factor, multiplier, issued_at: "2026-10-20T06:00:00Z" });

function seed(opts: { passed?: boolean; refresh?: "passed" | "failed" | "none"; demo?: boolean; override?: boolean; yesterdaySales?: boolean; extraRuns?: Record<string, unknown>[] } = {}): Seed {
  const passed = opts.passed ?? true;
  const refresh = opts.refresh ?? "passed";
  const runs: Record<string, unknown>[] = [
    { id: DAILY, restaurant_id: R, model_name: "forecast_daily", kind: "forecast", role: "production", status: "succeeded", passed, started_at: "2026-10-20T04:35:00Z", metrics: PASS_METRICS },
    ...(opts.extraRuns ?? []),
  ];
  if (refresh !== "none") {
    runs.push({ id: REFRESH, restaurant_id: R, model_name: "forecast_refresh", kind: "forecast", role: "production", status: refresh === "failed" ? "failed" : "succeeded", passed, started_at: "2026-10-20T06:00:00Z", metrics: { base_run_id: DAILY } });
  }
  const days = Array.from({ length: 8 }, (_, i) => addDay(TODAY, i));
  const forecasts = [
    // The 05:35 run: today 150 to 170 (so a test can tell it from the refresh); 100 a day after, Friday 70, Saturday 135.
    ...days.flatMap((d, i) => {
      const likely = i === 0 ? 160 : d === "2026-10-23" ? 70 : d === "2026-10-24" ? 135 : 100;
      return [fc(DAILY, d, "orders", likely - 10, likely, likely + 10), fc(DAILY, d, "sales_pence", likely * 1400, likely * 1500, likely * 1600)];
    }),
    // The 07:00 refresh: days 0 to 2.
    fc(REFRESH, TODAY, "orders", 97, 111, 123),
    fc(REFRESH, TODAY, "sales_pence", 145_400, 164_900, 190_100),
    fc(REFRESH, "2026-10-21", "orders", 90, 100, 110),
    fc(REFRESH, "2026-10-22", "orders", 90, 100, 110),
    // Another restaurant's forecast for today: never read.
    { ...fc(DAILY, TODAY, "orders", 1, 2, 3), id: "other", restaurant_id: OTHER },
  ];
  const drivers = [
    drv(REFRESH, TODAY, "weekday", 1.3),
    drv(REFRESH, TODAY, "school_holiday", 1.08),
    drv(REFRESH, TODAY, "rain_dinner", 0.94),
    drv(REFRESH, TODAY, "season", 0.9),
    drv(DAILY, TODAY, "eid_fitr_d1", 1.9),
    drv(DAILY, "2026-10-23", "rain_dinner", 0.88),
    drv(DAILY, "2026-10-24", "eid_fitr_d1", 1.3),
  ];
  const sales = Array.from({ length: 70 }, (_, i) => addDay(TODAY, -(i + 1)))
    .filter((d) => d !== "2026-10-19" || opts.yesterdaySales !== false)
    .map((d) => ({ id: `s-${d}`, restaurant_id: R, day: d, transactions: d === "2026-10-19" ? 104 : 100, covers: null, net_sales: 1500 }));
  return {
    restaurants: [{ id: R, name: "Ember & Spice Grill", is_demo: opts.demo ?? false, forecast_unvalidated: opts.override ?? false }],
    model_runs: runs,
    forecasts,
    forecast_drivers: drivers,
    sales_days: sales,
    forecast_briefs: [
      { id: "fb-yesterday", restaurant_id: R, day: "2026-10-19", status: "shown", orders_low: 90, orders_high: 120, offer: null, flags: [], updated_at: "2026-10-19T08:00:00Z" },
    ],
    restaurant_events: [],
    campaigns: [],
  };
}

const restaurantRow = (db: ReturnType<typeof memoryDb>) => db.tables.restaurants[0] as never;

describe("the brief's forecast, from the database", () => {
  let db: ReturnType<typeof memoryDb>;
  const alertBuilder = vi.fn(async () => "ok");
  const recipientsFor = vi.fn(async () => ({ eligible: [{ id: "c1" }], excluded: [], limited: 0 }));

  async function load(s: Seed) {
    vi.resetModules();
    db = memoryDb(s);
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder }));
    vi.doMock("@/lib/campaigns", () => ({ recipientsFor }));
    vi.doMock("@/lib/audit", () => ({ logAction: vi.fn(async () => {}) }));
    return import("@/lib/forecast");
  }

  beforeEach(() => {
    alertBuilder.mockClear();
    recipientsFor.mockClear();
    recipientsFor.mockImplementation(async () => ({ eligible: [{ id: "c1" }], excluded: [], limited: 0 }));
  });
  afterEach(() => vi.unstubAllEnvs());

  test("a passed 07:00 refresh: today's line, the why, yesterday as shown, the days ahead and the offer button", async () => {
    const { briefForecast } = await load(seed());
    const out = await briefForecast(restaurantRow(db), NOW);
    expect(out.block).toBe(
      [
        "📈 *Today, Tue 20 Oct:* likely 110 orders (95 to 125), about £1,650 before VAT",
        "Why: school holidays (+8%), rain this evening (-6%)",
        "Yesterday: 104 orders, inside the forecast (90 to 120) ✓",
        "Days ahead: Friday looks about 30% quieter than a normal Friday, mainly rain in the evening. Saturday looks about 35% busier than a normal Saturday, mainly Eid.",
      ].join("\n"),
    );
    expect(out.offer?.question).toBe(offerQuestion(quietFri));
    const row = db.tables.forecast_briefs.find((r) => r.day === TODAY)!;
    expect(row).toMatchObject({ status: "shown", run_id: REFRESH, run_name: "forecast_refresh", unvalidated: false, orders_low: 95, orders_likely: 110, orders_high: 125 });
    expect(out.offer?.id).toBe(row.id);
    expect(alertBuilder).not.toHaveBeenCalled();
    // Made once: the second call (a retry, or the other brief path) gives the same lines.
    expect((await briefForecast(restaurantRow(db), NOW)).block).toBe(out.block);
  });

  test("the refresh failed: the 05:35 run instead", async () => {
    const { briefForecast } = await load(seed({ refresh: "failed" }));
    const out = await briefForecast(restaurantRow(db), NOW);
    expect(out.block!.split("\n")[0]).toBe("📈 *Today, Tue 20 Oct:* likely 160 orders (150 to 170), about £2,400 before VAT");
    expect(out.block).toContain("Why: Eid (+90%)");
    expect(db.tables.forecast_briefs.find((r) => r.day === TODAY)).toMatchObject({ run_id: DAILY, run_name: "forecast_daily" });
  });

  test("never a passed run: nothing at all, no apology, no alert", async () => {
    const { briefForecast } = await load(seed({ passed: false }));
    expect(await briefForecast(restaurantRow(db), NOW)).toEqual({ block: null, offer: null });
    expect(db.tables.forecast_briefs.find((r) => r.day === TODAY)).toMatchObject({ status: "none" });
    expect(alertBuilder).not.toHaveBeenCalled();
  });

  test("a passed run recently but today's failed: one line for the owner, the reason for the builder", async () => {
    const earlier = { id: "aaaaaaaa-0000-0000-0000-000000000009", restaurant_id: R, model_name: "forecast_daily", kind: "forecast", role: "production", status: "succeeded", passed: true, started_at: "2026-10-17T04:35:00Z", metrics: {} };
    const s = seed({ refresh: "none", extraRuns: [earlier] });
    (s.model_runs[0] as Record<string, unknown>).status = "failed";
    const { briefForecast } = await load(s);
    const out = await briefForecast(restaurantRow(db), NOW);
    expect(out.block).toBe("📈 No forecast today.");
    expect(alertBuilder).toHaveBeenCalledWith(`forecast-missing:${R}:${TODAY}`, expect.stringContaining("the 05:35 run failed"));
  });

  test("yesterday's sales not in yet: no Yesterday line (the till report nudge says so instead)", async () => {
    const { briefForecast } = await load(seed({ yesterdaySales: false }));
    const out = await briefForecast(restaurantRow(db), NOW);
    expect(out.block).not.toContain("Yesterday");
  });

  test("the 7-day gap blocks the offer: said plainly, no button", async () => {
    recipientsFor.mockImplementation(async () => ({ eligible: [], excluded: [], limited: 12 }));
    const s = seed();
    s.campaigns = [{ id: "c-1", restaurant_id: R, is_birthday: false, sent_at: "2026-10-19T10:00:00Z", valid_from: "2026-10-19", valid_until: "2026-10-19", created_at: "2026-10-18T10:00:00Z" }];
    const { briefForecast } = await load(s);
    const out = await briefForecast(restaurantRow(db), NOW);
    expect(out.offer).toBeNull();
    expect(out.block).toContain("Everyone on your list had an offer email on Mon 19 Oct, and nobody gets more than one a week, so I can't send one for Friday.");
    expect(db.tables.forecast_briefs.find((r) => r.day === TODAY)!.offer).toMatchObject({ day: "2026-10-23", status: "blocked" });
  });

  test("the demo override shows unvalidated runs labelled TEST, only for a demo restaurant with TEST_TOOLS on", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    let f = await load(seed({ passed: false, demo: true, override: true }));
    expect((await f.briefForecast(restaurantRow(db), NOW)).block).toContain("📈 *Today, Tue 20 Oct (TEST: unvalidated forecast):* likely 110 orders");
    expect(db.tables.forecast_briefs.find((r) => r.day === TODAY)).toMatchObject({ unvalidated: true });

    // A real restaurant with the setting somehow on: nothing (the database refuses the setting too).
    f = await load(seed({ passed: false, demo: false, override: true }));
    expect((await f.briefForecast(restaurantRow(db), NOW)).block).toBeNull();

    // TEST_TOOLS off: nothing, even for the demo.
    vi.stubEnv("TEST_TOOLS", "false");
    f = await load(seed({ passed: false, demo: true, override: true }));
    expect((await f.briefForecast(restaurantRow(db), NOW)).block).toBeNull();
  });

  test("the reader never returns a run's rows that may not be shown, nor another restaurant's", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    const s = seed({ passed: false, demo: false, override: true });
    s.model_runs.push({ id: "bbbbbbbb-0000-0000-0000-000000000001", restaurant_id: R, model_name: "forecast_daily", kind: "forecast", role: "benchmark", status: "succeeded", passed: true, started_at: "2026-10-20T04:40:00Z", metrics: {} });
    await load(s);
    const models = await import("@/lib/ops/models");
    expect((await models.forecastFromRun(R, DAILY, TODAY, TODAY)).ok).toBe(false);
    expect((await models.forecastFromRun(R, "bbbbbbbb-0000-0000-0000-000000000001", TODAY, TODAY)).ok).toBe(false);
    (db.tables.model_runs[0] as Record<string, unknown>).passed = true;
    const ok = await models.forecastFromRun(R, DAILY, TODAY, TODAY);
    expect(ok.forecasts.every((f) => f.restaurant_id === R)).toBe(true);
    expect(ok.forecasts.some((f) => f.id === "other")).toBe(false);
  });

  test("the assistant's look-up: ranges with reasons from today's run", async () => {
    const { lookUpForecast } = await load(seed());
    const out = await lookUpForecast({ id: R }, NOW, "2026-10-24", "2026-10-24");
    expect(out.status).toBe("shown");
    expect(out.lines).toEqual(["Saturday 24 Oct: likely 135 orders (125 to 145), about £2,050 before VAT, about 35% busier than a normal Saturday; why: Eid (+30%)"]);
  });

  test("the report: each day against what its brief showed", async () => {
    const { forecastReportDays } = await load(seed());
    expect(await forecastReportDays(R, "2026-10-12", "2026-10-19")).toEqual({ unvalidated: false, days: [{ day: "2026-10-19", low: 90, high: 120, actual: 104 }] });
  });
});

// ---------- Both brief paths show the same block ----------

describe("the GM's brief and today's brief", () => {
  test("carry the same forecast lines, word for word, and the same offer buttons", async () => {
    vi.resetModules();
    const block = "📈 *Today, Tue 20 Oct:* likely 110 orders (95 to 125), about £1,650 before VAT\nWhy: half-term (+8%)";
    const offer = { id: "44444444-4444-4444-4444-444444444444", question: offerQuestion(quietFri) };
    const db = memoryDb({ drafts: [], restaurants: [{ id: R, name: "Ember" }] });
    const sent: { text: string; buttons: unknown }[] = [];
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/forecast", () => ({ briefForecast: vi.fn(async () => ({ block, offer })) }));
    vi.doMock("@/lib/notify", () => ({ messageOwner: vi.fn(async (_c: unknown, text: string, buttons: unknown) => void sent.push({ text, buttons })) }));
    vi.doMock("@/lib/feedback", () => ({ feedbackForBrief: vi.fn(async () => ({ lines: [], ids: [] })), markFeedbackReported: vi.fn(async () => {}) }));
    vi.doMock("@/lib/sales/z-reports", () => ({ zNudgeFor: vi.fn(async () => null) }));
    vi.doMock("@/lib/agents/gm", () => ({ queueGmBriefShadow: vi.fn(async () => {}), composeBrief: vi.fn(async () => ({ summary: "Morning! Quiet one today.", cards: [], rolled: [], usage: null })) }));
    vi.doMock("@/lib/agents/jobs", () => ({ recordAgentRun: vi.fn(async () => {}) }));
    const { sendBrief } = await import("@/lib/brief");
    const { gmBrief } = await import("@/lib/agents/gm-brief");
    const r = { id: R, name: "Ember", discount_cap_percent: 20 } as never;
    const channel = { from: "a", to: "b" } as never;

    expect(await sendBrief(r, channel, NOW)).toMatchObject({ sent: true });
    const legacy = [...sent];
    sent.length = 0;
    expect(await gmBrief(r, channel, NOW)).toMatchObject({ sent: true });
    const gm = [...sent];

    // Nothing to approve and no activity: the forecast alone is worth a brief.
    expect(legacy[0].text).toContain(`\n\n${block}`);
    expect(gm[0].text).toBe(`Morning! Quiet one today.\n\n${block}`);
    for (const msgs of [legacy, gm]) expect(msgs[1]).toEqual({ text: offer.question, buttons: { draftId: offer.id, buttons: "offer" } });
  });
});

// ---------- The offer tap ----------

describe("tapping the quiet-night offer", () => {
  const ROW = "55555555-5555-5555-5555-555555555555";
  const offerRow = (status = "offered") => ({
    id: ROW,
    restaurant_id: R,
    day: TODAY,
    status: "shown",
    flags: [],
    offer: { day: "2026-10-23", status, likely: 70, normal: 100, pct: -30, reason: "rain in the evening", question: "q" },
    updated_at: "2026-10-20T08:00:00Z",
  });

  async function tap(rows: Record<string, unknown>[], yes: boolean, growth = "off") {
    vi.resetModules();
    const db = memoryDb({ forecast_briefs: rows });
    const sent: string[] = [];
    const campaignCreateAndSend = vi.fn(async () => ({ id: "d-1", content: "x" }));
    const writeOfferCampaign = vi.fn(async () => ({ name: "Quiet Friday" }));
    const liveGrowthRequest = vi.fn(async () => true);
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/assistant", () => ({ writeOfferCampaign }));
    vi.doMock("@/lib/bot/flows", () => ({ campaignCreateAndSend }));
    vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), getLearningContext: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/agents/growth", () => ({ growthMode: vi.fn(async () => growth), liveGrowthRequest, queueGrowthShadow: vi.fn(async () => {}) }));
    vi.doMock("@/lib/campaigns", () => ({ recipientsFor: vi.fn() }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: vi.fn() }));
    const { answerOfferTap } = await import("@/lib/forecast/offer");
    const turn = { ctx: { restaurantId: R, restaurant: { id: R }, now: NOW }, send: async (t: string) => void sent.push(t) } as never;
    const handled = await answerOfferTap(turn, { yes, id: ROW });
    return { db, sent, handled, campaignCreateAndSend, writeOfferCampaign, liveGrowthRequest };
  }

  test("Draft an offer: the campaign flow, asked with the day, reason and shortfall from code", async () => {
    const t = await tap([offerRow()], true);
    expect(t.handled).toBe(true);
    expect(t.writeOfferCampaign).toHaveBeenCalledWith(expect.anything(), expect.anything(), offerRequest(quietFri));
    expect(t.campaignCreateAndSend).toHaveBeenCalledWith(expect.anything(), { name: "Quiet Friday" }, offerRequest(quietFri), expect.any(Function), "📧 Here's an offer for Friday 23 Oct:\n\n");
    expect(t.db.tables.forecast_briefs[0].offer).toMatchObject({ status: "drafted", draft_id: "d-1" });
  });

  test("Growth live drafts it instead", async () => {
    const t = await tap([offerRow()], true, "live");
    expect(t.liveGrowthRequest).toHaveBeenCalledWith({ id: R }, offerRequest(quietFri), NOW, expect.any(Function));
    expect(t.campaignCreateAndSend).not.toHaveBeenCalled();
  });

  test("Not now is recorded; a second tap after drafting doesn't draft twice", async () => {
    const no = await tap([offerRow()], false);
    expect(no.sent).toEqual(["OK, no offer for Friday."]);
    expect(no.db.tables.forecast_briefs[0].offer).toMatchObject({ status: "declined" });
    const again = await tap([offerRow("drafted")], true);
    expect(again.campaignCreateAndSend).not.toHaveBeenCalled();
    expect(again.sent[0]).toContain("already drafted");
  });
});
