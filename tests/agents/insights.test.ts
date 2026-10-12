// Insights agent tests, offline (every push): query_metrics gives the known right
// figures on the saved test data, the plain-code rules catch what they must, the
// saved cases are well formed, and every recorded answer passes its case. The live
// run is tests/agents-live/insights.eval.ts.
import { describe, expect, test } from "vitest";
import { anomaliesIn, numbersIn, periodRange, queryMetrics, type MetricQueryInput, type MetricResult } from "@/lib/agents/insights-metrics";
import { insightsProblems, quotedNumbers, type InsightsOutput } from "@/lib/agents/insights-rules";
import { caseData, judgeInsights, loadInsightsCases, type InsightsCase } from "./support/insights-cases";

const cases = loadInsightsCases();
const byName = (prefix: string) => cases.find((c) => c.file.startsWith(prefix))!.case;
const q = (o: Partial<MetricQueryInput> & Pick<MetricQueryInput, "metric" | "period">): MetricQueryInput => ({ date: null, from: null, to: null, weekday: null, compare: "none", campaign: null, ...o });
const ok = (r: MetricResult) => {
  if (!r.available) throw new Error(`${r.metric} unavailable`);
  return r;
};

describe("periods", () => {
  test("weeks run Monday to Sunday; last_week is the last full one", () => {
    expect(periodRange(q({ metric: "net_sales", period: "last_week" }), "2026-10-05")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodRange(q({ metric: "net_sales", period: "last_week" }), "2026-10-08")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodRange(q({ metric: "net_sales", period: "this_week" }), "2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-07" });
    expect(periodRange(q({ metric: "net_sales", period: "last_month" }), "2026-10-05")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(() => periodRange(q({ metric: "net_sales", period: "day" }), "2026-10-05")).toThrow(/date/);
  });
});

describe("query_metrics on the saved data (the cases' known right figures)", () => {
  const ember = caseData(byName("01"));

  test("last week against the week before", () => {
    const r = ok(queryMetrics(ember, q({ metric: "net_sales", period: "last_week", compare: "previous_period" }), "q1"));
    const want = byName("01").expect.figures!;
    expect(r.value!.value).toBe(want[0].value);
    expect(r.compare!.value).toBe(want[1].value);
    expect(r.value!.display).toBe("£13,515");
    expect(r.compare!.change_pct).toBe(-2);
    expect(r.days_with_data).toBe(7);
    expect(r.source).toBe("dummy data");
    expect(r.small_sample).toBeNull();
  });

  test("last Saturday against the 4 Saturdays before", () => {
    const r = ok(queryMetrics(ember, q({ metric: "net_sales", period: "last_week", weekday: "Saturday", compare: "same_weekday_last_4" }), "q1"));
    const want = byName("02").expect.figures!;
    expect([r.value!.value, r.compare!.value]).toEqual([want[0].value, want[1].value]);
    expect(r.period.label).toBe("Sat 3 Oct");
  });

  test("covers aren't recorded; transactions are", () => {
    expect(queryMetrics(ember, q({ metric: "covers", period: "yesterday" }), "q1")).toMatchObject({ available: false, missing: expect.stringMatching(/covers/) });
    const r = ok(queryMetrics(ember, q({ metric: "transactions", period: "day", date: "2026-10-02" }), "q2"));
    expect(r.value!.value).toBe(byName("03").expect.figures![0].value);
  });

  test("dish margins and labour cost say what's missing", () => {
    expect(queryMetrics(ember, q({ metric: "dish_margins", period: "last_month" }), "q1")).toMatchObject({ available: false, missing: "dish costs" });
    expect(queryMetrics(ember, q({ metric: "labour_cost", period: "last_week" }), "q1")).toMatchObject({ available: false });
  });

  test("a campaign: redemptions, and sales on its days next to the usual (with the not-a-cause note)", () => {
    const data = caseData(byName("08"));
    const r = ok(queryMetrics(data, q({ metric: "campaign_results", period: "last_week", campaign: "thursday family" }), "q1"));
    expect(r.value!.value).toBe(26);
    expect(r.small_sample).toBeNull();
    const extra = r.rows[0].extra!;
    expect((extra.net_sales_on_offer_days as { value: number }).value).toBe(3150);
    expect((extra.difference_pct as { value: number }).value).toBeGreaterThan(40);
    expect(r.notes.join(" ")).toMatch(/doesn't show the offer caused/);
  });

  test("under 20 redemptions is a small sample", () => {
    const r = ok(queryMetrics(ember, q({ metric: "campaign_results", period: "last_4_weeks", campaign: "tuesday" }), "q1"));
    expect(r.value!.value).toBe(3);
    expect(r.small_sample).toMatch(/Only 3 redemptions/);
  });

  test("under 4 weeks of sales data is a small sample", () => {
    const r = ok(queryMetrics(caseData(byName("09")), q({ metric: "net_sales", period: "last_week" }), "q1"));
    expect(r.value!.value).toBe(byName("09").expect.figures![0].value);
    expect(r.small_sample).toMatch(/Only 21 days/);
  });

  test("a till figure 3 times the usual is flagged as an anomaly", () => {
    const data = caseData(byName("12"));
    const r = ok(queryMetrics(data, q({ metric: "net_sales", period: "last_week", weekday: "Saturday" }), "q1"));
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ day: "2026-10-03", times: 3, source: "till reports" });
    expect(anomaliesIn(ember, ["2026-10-03"])).toEqual([]);
  });

  test("reviews, sign-ups, the cafe, hours and items", () => {
    expect(ok(queryMetrics(ember, q({ metric: "reviews", period: "last_month" }), "q1")).value!.value).toBe(byName("13").expect.figures![0].value);
    expect(ok(queryMetrics(ember, q({ metric: "list_growth", period: "last_week" }), "q1")).value!.value).toBe(byName("14").expect.figures![0].value);
    const cafe = ok(queryMetrics(caseData(byName("16")), q({ metric: "net_sales", period: "last_week", compare: "previous_period" }), "q1"));
    expect([cafe.value!.value, cafe.compare!.value]).toEqual(byName("16").expect.figures!.map((f) => f.value));
    const hours = ok(queryMetrics(ember, q({ metric: "sales_by_hour", period: "last_4_weeks", weekday: "Friday" }), "q1"));
    expect(hours.notes.join(" ")).toMatch(/Busiest hour: 19:00 to 20:00/);
    const items = ok(queryMetrics(ember, q({ metric: "item_sales", period: "last_week" }), "q1"));
    expect(items.rows[0]).toMatchObject({ label: "Garlic Naan", value: 322 });
  });

  test("rainy against dry days is a pattern, with both averages", () => {
    const r = ok(queryMetrics(ember, q({ metric: "rain_vs_dry", period: "last_12_weeks" }), "q1"));
    expect(r.rows.map((x) => x.label)).toEqual([expect.stringMatching(/^Rainy days/), expect.stringMatching(/^Dry days/)]);
    expect(r.notes.join(" ")).toMatch(/not a cause/);
  });

  test("Google stats don't exist in dummy mode", () => {
    expect(queryMetrics(ember, q({ metric: "google_stats", period: "last_week" }), "q1")).toMatchObject({ available: false });
  });

  test("numbersIn lists what a figure may quote", () => {
    const r = queryMetrics(ember, q({ metric: "net_sales", period: "last_week", compare: "previous_period" }), "q1");
    expect(numbersIn(r).map((n) => n.value)).toEqual(expect.arrayContaining([13514.92, 13745.33, -2, 7]));
  });
});

describe("numbers in the words", () => {
  test("money, percentages and counts count; dates, times and period words don't", () => {
    const found = quotedNumbers("Saturday 3 October took £3,141, up 6% on the 4 Saturdays before (£2,957), from 134 bills between 7pm and 19:00 on 2 Oct 2026, over the last 4 weeks.");
    expect(found.map((n) => [n.kind, n.value])).toEqual([
      ["money", 3141],
      ["percent", 6],
      ["money", 2957],
      ["number", 134],
    ]);
  });
});

describe("the rules", () => {
  const data = caseData(byName("01"));
  const results = new Map<string, MetricResult>([["q1", queryMetrics(data, q({ metric: "net_sales", period: "last_week", compare: "previous_period" }), "q1")]]);
  const answer = (o: Partial<InsightsOutput> = {}, body = "Last week took £13,515 net, down 2% on the week before (£13,745)."): InsightsOutput => ({
    type: "answer",
    channel: "owner",
    content: { headline: "", body, actions: [] },
    figures: [
      { metric: "net_sales", value: 13514.92, unit: "GBP", period: "28 Sep to 4 Oct", compare_to: "the week before", compare_value: 13745.33, source: "metrics:q1" },
      { metric: "net_sales_change", value: -2, unit: "percent", period: "28 Sep to 4 Oct", compare_to: "the week before", compare_value: null, source: "metrics:q1" },
    ],
    confidence: "high",
    needs_owner_input: null,
    sources_used: ["metrics:q1"],
    ...o,
  });
  const p = (out: InsightsOutput, r = results, task: "answer" | "report" = "answer") => insightsProblems(out, { task, results: r }).join(" | ");

  test("a right answer passes", () => expect(p(answer())).toBe(""));
  test("a number that isn't a figure, or a figure that isn't from query_metrics, is caught", () => {
    expect(p(answer({}, "Last week took £13,515 net, about £230 less than the week before."))).toMatch(/"£230" isn't in figures/);
    expect(p(answer({ figures: [{ ...answer().figures[0], value: 13600 }] }, "Last week took £13,600."))).toMatch(/isn't in metrics:q1: never work a figure out yourself/);
    expect(p(answer({ figures: [{ ...answer().figures[0], source: "metrics:q9" }] }))).toMatch(/source must be metrics:<id>/);
    expect(p(answer({ sources_used: ["metrics:q1", "metrics:q7"] }))).toMatch(/metrics:q7 isn't a query_metrics result/);
  });
  test("causes stated as fact, advice and jargon are caught", () => {
    expect(p(answer({}, "Last week took £13,515 net, down 2%. The rain caused it."))).toMatch(/states a cause/);
    expect(p(answer({}, "Last week took £13,515 net. The Thursday offer brought in £13,515."))).toMatch(/states a cause/);
    expect(p(answer({}, "Last week took £13,515 net, so you should cut a member of staff on Mondays."))).toMatch(/advice on staffing/);
    expect(p(answer({}, "Last week took £13,515 net, AOV was steady."))).toMatch(/jargon/);
    expect(p(answer({}, "Took £13,515.\nReally.\nYes.\nTruly."))).toMatch(/1 to 3 sentences/);
  });
  test("a small sample must be flagged, with low confidence", () => {
    const small = new Map([["q1", queryMetrics(caseData(byName("09")), q({ metric: "net_sales", period: "last_week", compare: "previous_period" }), "q1")]]);
    const out = answer({ figures: [{ ...answer().figures[0], compare_value: null }] }, "Last week took £13,515 net.");
    expect(p(out, small)).toMatch(/confidence must be low/);
    expect(p({ ...out, confidence: "low" }, small)).toMatch(/say plainly that the sample is small/);
    expect(p({ ...out, confidence: "low", content: { ...out.content, body: "Last week took £13,515 net, but there are only 21 days of figures so far." }, figures: [...out.figures, { metric: "days", value: 21, unit: "count", period: "so far", compare_to: null, compare_value: null, source: "metrics:q1" }] }, small)).toBe("");
  });
  test("a till figure that looks wrong: the answer must ask the owner first", () => {
    const odd = new Map([["q1", queryMetrics(caseData(byName("12")), q({ metric: "net_sales", period: "last_week", weekday: "Saturday" }), "q1")]]);
    const out = answer({ figures: [{ metric: "net_sales", value: 8601.75, unit: "GBP", period: "Sat 3 Oct", compare_to: null, compare_value: null, source: "metrics:q1" }] }, "Saturday took £8,602.");
    expect(p(out, odd)).toMatch(/set needs_owner_input and ask the owner to check/);
    const ask = { ...out, content: { headline: "", body: "", actions: [] }, needs_owner_input: "Saturday's till report says £8,602, about 3 times your usual Saturday (£2,867). Is that right?" };
    expect(p(ask, odd)).toBe("");
    expect(p({ ...ask, needs_owner_input: "Saturday's till report says £9,999. Is that right?" }, odd)).toMatch(/"£9,999" in the question/);
  });
  test("the report: a one-sentence headline and exactly 3 actions, each tied to a number", () => {
    const action = { title: "Push the Saturday grill", why: "Saturday took £13,515 across the week.", message: "Draft a Google post about our mixed grill" };
    const report = answer({ type: "report_section", content: { headline: "Last week took £13,515 net, down 2% on the week before.", body: "Sales were £13,515.", actions: [action, action, action] } });
    expect(p(report, results, "report")).toBe("");
    expect(p({ ...report, content: { ...report.content, actions: [action] } }, results, "report")).toMatch(/exactly 3 actions/);
    expect(p({ ...report, content: { ...report.content, actions: [action, action, { ...action, why: "Saturdays are busy." }] } }, results, "report")).toMatch(/action 3's why must be tied to a number/);
  });
});

test("Insights has 10 to 20 saved cases, covering every situation phase 3b lists", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  expect(cases.length).toBeLessThanOrEqual(20);
  const names = cases.map((c) => c.file).join(" ");
  for (const kind of ["how-was-last-week", "saturday-compare", "dish-margins", "campaign-coincided", "small-sample-weeks", "small-sample-redemptions", "staff-cut-mondays", "zreport-3x", "monday-report"]) expect(names).toContain(kind);
});

describe.each(cases)("insights case $file", ({ case: c }) => {
  test("is well formed", () => {
    expect(c.name && c.source && c.today && c.today_words).toBeTruthy();
    expect(c.task === "answer" ? Boolean(c.question) : c.question === null).toBe(true);
    expect(caseData(c).sales_days.every((d) => d.day < c.today)).toBe(true);
    expect(c.profile.fields).toHaveProperty("hours");
  });
});

// A recorded answer is judged against the same query results it saw (the queries are re-run in order).
function replay(c: InsightsCase) {
  const r = c.recorded!;
  const data = caseData(c);
  const results = new Map(r.queries.map((query, i) => [`q${i + 1}`, queryMetrics(data, query, `q${i + 1}`)]));
  return { outcome: r.outcome, by: r.question_by, question: r.question, output: r.output, results, checker: r.checker };
}

describe.each(cases.filter((c) => c.case.recorded))("recorded answer: $file", ({ case: c }) => {
  test("passes its case", () => expect(judgeInsights(c, replay(c))).toEqual([]));
});
