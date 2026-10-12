// Saved Insights cases (agents/tests/insights/*.json): the owner's question (or the
// Monday report), which demo restaurant's saved numbers it's asked against
// (agents/tests/insights/data/<restaurant>.json, made by
// scripts/export-insights-fixture.mjs), changes to those numbers for the case
// (a till figure that looks wrong, a campaign, only 3 weeks of data), the known
// right figures, and the recorded answer.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MetricQueryInput, MetricResult, MetricsData } from "@/lib/agents/insights-metrics";
import { insightsProblems, type InsightsOutput, type InsightsTask } from "@/lib/agents/insights-rules";
import type { CheckerVerdictOutput } from "@/lib/agents/schema";

export type InsightsCase = {
  name: string;
  source: string;
  task: InsightsTask;
  question: string | null;
  restaurant: "ember-spice" | "cardamom-corner";
  // The restaurant's London date ("YYYY-MM-DD"), and in words. Data from this day on is left out.
  today: string;
  today_words: string;
  profile: { version: number; fields: Record<string, unknown> };
  themes: { week: string; praise: { label: string; count: number }[]; complaints: { label: string; count: number }[] } | null;
  patch: {
    // Leave out sales before this day (a restaurant that only started sending figures recently).
    keep_from?: string;
    sales_days?: { day: string; net: number; gross?: number | null; transactions?: number | null; source?: string }[];
    campaigns?: MetricsData["campaigns"];
    // Sends for a campaign: how many were emailed, opened, clicked and redeemed.
    sends?: { campaign_id: string; sent_at: string; emailed: number; opened: number; clicked: number; redeemed: number; redeemed_on: string }[];
  } | null;
  expect: {
    outcome: "answer" | "question";
    // A question for the owner is also a right answer.
    question_ok?: boolean;
    // Known right figures: each must be among the answer's figures (exact, or rounded for reading).
    figures?: { what: string; value: number; unit: "GBP" | "count" | "percent" | "stars" }[];
    // At least one of these must appear (case-insensitive) in what the owner reads.
    mention_any?: string[];
    must_not_contain?: string[];
    confidence?: "high" | "low";
    checker?: CheckerVerdictOutput["verdict"][];
  };
  recorded: {
    outcome: "reply" | "question";
    question_by: "insights" | "checker" | null;
    question: string | null;
    output: InsightsOutput;
    queries: MetricQueryInput[];
    checker: Pick<CheckerVerdictOutput, "verdict" | "checks" | "minor_fixes" | "owner_question"> | null;
    revisions: number;
    agent_version: string;
    checker_version: string | null;
    recorded_at: string;
  } | null;
};

export const INSIGHTS_DIR = join("agents", "tests", "insights");

export function loadInsightsCases() {
  return readdirSync(INSIGHTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(INSIGHTS_DIR, file), "utf8")) as InsightsCase }));
}

export function saveInsightsRecorded(file: string, recorded: InsightsCase["recorded"]) {
  const path = join(INSIGHTS_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as InsightsCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

const fixtures = new Map<string, Omit<MetricsData, "today">>();
function fixture(slug: string) {
  if (!fixtures.has(slug)) fixtures.set(slug, JSON.parse(readFileSync(join(INSIGHTS_DIR, "data", `${slug}.json`), "utf8")));
  return fixtures.get(slug)!;
}

// The numbers a case is asked against: the saved fixture as it was on the case's
// "today" (nothing from that day on), with the case's changes.
export function caseData(c: Pick<InsightsCase, "restaurant" | "today" | "patch">): MetricsData {
  const f = fixture(c.restaurant);
  const p = c.patch ?? {};
  const before = (d: string) => d.slice(0, 10) < c.today;
  const keep = (d: string) => before(d) && (!p.keep_from || d.slice(0, 10) >= p.keep_from);
  const days = new Map(f.sales_days.filter((d) => keep(d.day)).map((d) => [d.day, d]));
  for (const d of p.sales_days ?? []) {
    const old = days.get(d.day);
    days.set(d.day, { day: d.day, net: d.net, gross: d.gross ?? old?.gross ?? null, transactions: d.transactions ?? old?.transactions ?? null, source: d.source ?? old?.source ?? "seed" });
  }
  const sends = (p.sends ?? []).flatMap((s) =>
    Array.from({ length: s.emailed }, (_, i) => ({
      campaign_id: s.campaign_id,
      delivery: "email",
      sent_at: s.sent_at,
      opened_at: i < s.opened ? s.sent_at : null,
      clicked_at: i < s.clicked ? s.sent_at : null,
      redeemed_at: i < s.redeemed ? `${s.redeemed_on}T19:00:00.000Z` : null,
    })),
  );
  return {
    today: c.today,
    sales_days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    sales_hours: f.sales_hours.filter((h) => keep(h.day)),
    sales_items: f.sales_items.filter((i) => keep(i.day)),
    weather: f.weather.filter((w) => before(w.day)),
    reviews: f.reviews.filter((r) => before(r.date)),
    signups: f.signups.filter(before),
    campaigns: [...f.campaigns.filter((x) => !x.sent_at || before(x.sent_at)), ...(p.campaigns ?? [])],
    sends: [...f.sends.filter((x) => before(x.sent_at)).map((x) => ({ ...x, redeemed_at: x.redeemed_at && before(x.redeemed_at) ? x.redeemed_at : null })), ...sends],
    rewards: f.rewards.filter((x) => before(x.created_at)),
    google: null,
  };
}

export type InsightsResult = {
  outcome: "reply" | "question";
  by?: "insights" | "checker" | null;
  question?: string | null;
  output: InsightsOutput;
  results: Map<string, MetricResult>;
  checker: { verdict: string } | null;
};

const close = (a: number, b: number) => Math.abs(a - b) < 0.005 || Math.round(a) === Math.round(b);

// What's wrong with a result for this case. Empty = it's right.
export function judgeInsights(c: InsightsCase, r: InsightsResult) {
  const e = c.expect;
  const out = r.output;
  const read = [out.needs_owner_input ?? "", r.question ?? "", out.content.headline, out.content.body, ...out.content.actions.flatMap((a) => [a.title, a.why, a.message])].join("\n").toLowerCase();
  const problems: string[] = [];
  if (r.outcome === "question") {
    if (e.outcome !== "question" && !e.question_ok) return [`expected an answer, got a question (${r.by}): ${r.question ?? ""}`];
    if (r.by === "insights") problems.push(...insightsProblems(out, { task: c.task, results: r.results, themes: c.themes }));
  } else {
    if (e.outcome === "question") problems.push(`expected a question for the owner, got: ${out.content.body}`);
    problems.push(...insightsProblems(out, { task: c.task, results: r.results, themes: c.themes }));
    for (const f of e.figures ?? []) {
      if (!out.figures.some((x) => (x.unit === f.unit || (f.unit === "count" && x.unit !== "GBP")) && (close(x.value, f.value) || (x.compare_value !== null && close(x.compare_value, f.value))))) {
        problems.push(`missing the figure ${f.what} = ${f.value}`);
      }
    }
    if (e.confidence && out.confidence !== e.confidence) problems.push(`confidence ${out.confidence}, expected ${e.confidence}`);
    if (e.checker) {
      if (!r.checker) problems.push("no checker verdict");
      else if (!e.checker.includes(r.checker.verdict as never)) problems.push(`checker said ${r.checker.verdict}, expected ${e.checker.join(" or ")}`);
    }
  }
  if (e.mention_any?.length && !e.mention_any.some((w) => read.includes(w.toLowerCase()))) problems.push(`should mention one of: ${e.mention_any.join(", ")}`);
  for (const w of e.must_not_contain ?? []) if (read.includes(w.toLowerCase())) problems.push(`must not contain "${w}"`);
  return problems;
}
