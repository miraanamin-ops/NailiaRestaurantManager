import "server-only";
import { logAction } from "@/lib/audit";
import { londonYmd } from "@/lib/clock";
import { google } from "@/lib/google";
import { addDays } from "@/lib/sales/format";
import { selectAll } from "@/lib/sales/store";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { isTestMode } from "@/lib/test-mode";
import { londonToday } from "./checker-core";
import { insightsLoop, REPORT_QUERIES, type InsightsInput, type InsightsOutcome } from "./insights-core";
import type { MetricsData } from "./insights-metrics";
import { insightsText, type InsightsOutput } from "./insights-rules";
import { enqueueAgentJob, recordAgentRun, type AgentJob, type JobOutcome } from "./jobs";
import { agentMode } from "./modes";
import { callTool } from "./tools";

// The Insights agent with the database: the restaurant's numbers for
// query_metrics, shadow mode (owner number questions and the Monday report's
// words, saved next to what today's assistant wrote for the /log comparison),
// and live mode (Insights answers the owner's number questions and writes the
// report's words; TEST_MODE only for now).

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------- The go-live checklist: at least 2 weeks of sales data ----------

export const MIN_SALES_DAYS = 14;

// Days of real sales figures (till reports or POS files). A demo restaurant's
// dummy data counts too, but only in test mode (so the switch can be tried).
export async function salesDaysFor(restaurant: Pick<Restaurant, "id" | "is_demo">) {
  const sources = restaurant.is_demo && isTestMode() ? ["z_report", "pos", "seed"] : ["z_report", "pos"];
  const { count, error } = await getSupabase().from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).in("source", sources);
  return error ? 0 : (count ?? 0);
}

export async function insightsChecklist(restaurant: Pick<Restaurant, "id" | "is_demo">) {
  const days = await salesDaysFor(restaurant);
  const label = `2+ weeks of sales data from till reports or POS files (${days} day${days === 1 ? "" : "s"} so far${restaurant.is_demo && isTestMode() ? ", dummy data counts in test mode" : ""})`;
  return { ready: days >= MIN_SALES_DAYS, days, labels: days >= MIN_SALES_DAYS ? [] : [label], label };
}

// Live only once the checklist passes, and for now only with TEST_MODE on:
// live answers reach the owner, which mustn't happen outside test mode yet.
export async function insightsMode(restaurant: Restaurant) {
  const mode = agentMode(restaurant, "insights");
  if (mode === "live" && (!isTestMode() || !(await insightsChecklist(restaurant)).ready)) return "shadow";
  return mode;
}

// ---------- The numbers ----------

// Everything query_metrics can use, for one restaurant: about 13 months back.
export async function loadMetricsData(restaurantId: string, today: string): Promise<MetricsData> {
  const supabase = getSupabase();
  const since = addDays(today, -400);
  const [days, hours, items, weather, reviews, events, campaigns, sends, rewards] = await Promise.all([
    selectAll<{ day: string; net_sales: number; gross_sales: number | null; transactions: number | null; source: string; net_estimated: boolean; is_dummy: boolean }>((from, to) =>
      supabase.from("sales_days").select("day, net_sales, gross_sales, transactions, source, net_estimated, is_dummy").eq("restaurant_id", restaurantId).gte("day", since).lt("day", today).order("day").range(from, to),
    ),
    selectAll<{ day: string; hour: number; sales: number }>((from, to) =>
      supabase.from("sales_hours").select("day, hour, sales").eq("restaurant_id", restaurantId).gte("day", since).lt("day", today).order("day").range(from, to),
    ),
    selectAll<{ day: string; item: string; quantity: number; amount: number }>((from, to) =>
      supabase.from("sales_items").select("day, item, quantity, amount").eq("restaurant_id", restaurantId).gte("day", since).lt("day", today).order("day").range(from, to),
    ),
    selectAll<{ day: string; temp_max: number | null; temp_min: number | null; rain_mm: number | null; conditions: string | null }>((from, to) =>
      supabase.from("weather_days").select("day, temp_max, temp_min, rain_mm, conditions").eq("restaurant_id", restaurantId).gte("day", since).lt("day", today).order("day").range(from, to),
    ),
    google().listReviews(restaurantId),
    supabase.from("customer_events").select("created_at").eq("restaurant_id", restaurantId).eq("type", "signup").returns<{ created_at: string }[]>(),
    supabase
      .from("campaigns")
      .select("id, name, offer, segment, is_birthday, sent_at, valid_from, valid_until")
      .eq("restaurant_id", restaurantId)
      .returns<MetricsData["campaigns"]>(),
    supabase
      .from("campaign_sends")
      .select("campaign_id, delivery, created_at, opened_at, clicked_at, redeemed_at")
      .eq("restaurant_id", restaurantId)
      .eq("kind", "customer")
      .returns<{ campaign_id: string; delivery: string; created_at: string; opened_at: string | null; clicked_at: string | null; redeemed_at: string | null }[]>(),
    supabase.from("rewards").select("created_at, redeemed_at").eq("restaurant_id", restaurantId).returns<MetricsData["rewards"]>(),
  ]);
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    today,
    sales_days: days.map((d) => ({ day: d.day, net: Number(d.net_sales), gross: n(d.gross_sales), transactions: d.transactions, source: d.source, net_estimated: d.net_estimated, dummy: d.is_dummy })),
    sales_hours: hours.map((h) => ({ day: h.day, hour: h.hour, sales: Number(h.sales) })),
    sales_items: items.map((i) => ({ day: i.day, item: i.item, quantity: Number(i.quantity), amount: Number(i.amount) })),
    weather: weather.map((w) => ({ day: w.day, temp_max: n(w.temp_max), temp_min: n(w.temp_min), rain_mm: n(w.rain_mm), conditions: w.conditions })),
    reviews: reviews.filter((r) => r.review_date.slice(0, 10) < today).map((r) => ({ date: r.review_date, rating: r.rating, replied_at: r.reply_posted_at ?? null })),
    signups: (ok(events) ?? []).map((e) => e.created_at),
    campaigns: ok(campaigns) ?? [],
    sends: (ok(sends) ?? []).map((s) => ({ campaign_id: s.campaign_id, delivery: s.delivery, sent_at: s.created_at, opened_at: s.opened_at, clicked_at: s.clicked_at, redeemed_at: s.redeemed_at })),
    rewards: ok(rewards) ?? [],
    // Views, calls and direction requests only exist once Google is connected for real.
    google: null,
  };
}

async function themesFor(restaurantId: string, weekStart: string): Promise<InsightsInput["themes"]> {
  const { data } = await getSupabase()
    .from("review_themes")
    .select("praise, complaints")
    .eq("restaurant_id", restaurantId)
    .eq("week_start", weekStart)
    .maybeSingle<{ praise: { label: string; count: number }[]; complaints: { label: string; count: number }[] }>();
  if (!data || (!data.praise.length && !data.complaints.length)) return null;
  const strip = (xs: { label: string; count: number }[]) => xs.map(({ label, count }) => ({ label, count }));
  return { week: weekStart, praise: strip(data.praise), complaints: strip(data.complaints) };
}

export type InsightsJob = {
  task: "answer" | "report";
  question?: string | null;
  // "YYYY-MM-DD": the restaurant's date the question was asked (or the report's Monday).
  today: string;
  // What today's assistant said (answers), or wrote in the report (sentence and actions).
  legacy_text?: string | null;
  report_id?: string | null;
};

export async function runInsightsFor(restaurant: Restaurant, job: InsightsJob, label: string) {
  const [profile, checkerProfile, data] = await Promise.all([
    callTool("insights", "get_profile", restaurant.id, {}),
    callTool("checker", "get_profile", restaurant.id, {}),
    loadMetricsData(restaurant.id, job.today),
  ]);
  const weekStart = addDays(job.today, -((new Date(`${job.today}T12:00:00Z`).getUTCDay() + 6) % 7) - 7);
  const input: InsightsInput = {
    task: job.task,
    question: job.question ?? null,
    profile,
    data,
    prepared: job.task === "report" ? REPORT_QUERIES : [],
    themes: job.task === "report" ? await themesFor(restaurant.id, weekStart) : null,
    today: londonToday(new Date(`${job.today}T12:00:00Z`)),
  };
  const started = Date.now();
  const outcome = await insightsLoop(input, { resolve: (refs) => callTool("checker", "resolve_sources", restaurant.id, { refs }), checkerProfile }, label);
  return { outcome, profileVersion: profile.version, ms: Date.now() - started };
}

export function insightsOutcomeLine(outcome: InsightsOutcome) {
  const rev = outcome.revisions ? ` after ${outcome.revisions} revision${outcome.revisions === 1 ? "" : "s"}` : "";
  if (outcome.kind === "reply") return `would ${outcome.output.type === "answer" ? "answer" : "write the report words"} (checker ${outcome.checker.verdict}${rev}, ${outcome.queries.length} quer${outcome.queries.length === 1 ? "y" : "ies"})`;
  return `would ask the owner${outcome.by === "checker" ? ` (the checker escalated${rev})` : ""}: ${outcome.question}`;
}

// ---------- Shadow mode ----------

// Queued next to what today's assistant did. Never throws.
export async function queueInsightsShadow(restaurant: Restaurant, job: InsightsJob, key: string) {
  try {
    if ((await insightsMode(restaurant)) !== "shadow") return null;
    return await enqueueAgentJob({ restaurantId: restaurant.id, key, agent: "insights", kind: "insights_shadow", trigger: job.task === "report" ? "monday_report" : "owner_question", input: job as Record<string, unknown> });
  } catch (err) {
    console.error("Couldn't queue Insights in shadow mode", err);
    return null;
  }
}

export async function runInsightsShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as InsightsJob;
  const restaurant = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!restaurant) throw new Error("Restaurant not found");
  const { outcome, profileVersion, ms } = await runInsightsFor(restaurant, input, `${input.task === "report" ? "the Monday report" : "an owner question"} (shadow)`);
  ok(
    await getSupabase()
      .from("shadow_drafts")
      .insert({
        restaurant_id: job.restaurant_id,
        agent: "insights",
        agent_version: outcome.agentVersion,
        checker_version: outcome.checkerVersion,
        job_id: job.id,
        source: input.task === "report" ? "monday_report" : "owner_question",
        task: input.task,
        subject: { question: input.question ?? null, today: input.today, report_id: input.report_id ?? null, ms, queries: outcome.queries },
        legacy_draft_id: null,
        legacy_text: input.legacy_text ?? null,
        outcome: outcome.kind,
        output: outcome.output,
        question: outcome.kind === "question" ? outcome.question : null,
        checker: outcome.checker,
        revisions: outcome.revisions,
        steps: outcome.steps,
        profile_version: profileVersion,
      }),
  );
  return {
    output: { outcome: outcome.kind, revisions: outcome.revisions, checker_version: outcome.checkerVersion, steps: outcome.steps, ms },
    agentVersion: outcome.agentVersion,
    verdict: outcome.kind === "reply" ? outcome.checker.verdict : outcome.kind,
    usage: outcome.usage,
    actor: "insights",
    action: "agent_drafted",
    detail: `Insights (shadow, v${outcome.agentVersion}) on ${input.task === "report" ? "the Monday report" : `"${(input.question ?? "").slice(0, 80)}"`}: ${insightsOutcomeLine(outcome)}`,
  };
}

// ---------- Live mode: answering the owner ----------

// What the owner reads for a live answer.
export function answerText(outcome: InsightsOutcome) {
  return outcome.kind === "question" ? `❓ ${outcome.question}` : `📊 ${outcome.output.content.body.trim()}`;
}

// Live (TEST_MODE only): Insights answers the owner's number question straight
// away. Returns false if it couldn't (today's assistant answers instead).
export async function answerWithInsights(restaurant: Restaurant, question: string, now: Date, send: (text: string) => Promise<unknown>) {
  const job: InsightsJob = { task: "answer", question, today: londonYmd(now) };
  try {
    const { outcome, ms } = await runInsightsFor(restaurant, job, "an owner question (live)");
    await send(answerText(outcome));
    const key = `insights:answer:${Date.now()}`;
    const jobId = await recordAgentRun({
      restaurantId: restaurant.id,
      key,
      agent: "insights",
      kind: "insights_live",
      trigger: "owner_question",
      output: { outcome: outcome.kind, revisions: outcome.revisions, steps: outcome.steps, ms, question },
      agentVersion: outcome.agentVersion,
      verdict: outcome.kind === "reply" ? outcome.checker.verdict : "question",
      usage: outcome.usage,
    });
    await logAction({
      restaurantId: restaurant.id,
      actor: "insights",
      action: "agent_drafted",
      detail: `Insights (live, v${outcome.agentVersion}) answered "${question.slice(0, 80)}": ${insightsOutcomeLine(outcome).replace(/^would /, "")}`,
      data: { job_key: key, kind: "insights_live" },
      job: { jobId, agent: "insights", agentVersion: outcome.agentVersion, verdict: outcome.kind === "reply" ? outcome.checker.verdict : "question" },
    });
    return true;
  } catch (err) {
    console.error("Insights couldn't answer; today's assistant answers instead", err);
    return false;
  }
}

// ---------- The Monday report ----------

// The report's words from today's code, for the comparison.
export function legacyReportText(sentence: string, actions: { title: string; why: string }[]) {
  return [sentence, ...actions.map((a, i) => `${i + 1}. ${a.title}: ${a.why}`)].join("\n");
}

// Live (TEST_MODE only): Insights writes the headline, the sales words and the
// 3 actions around the figures code prepared. Null if it couldn't (the report
// keeps today's words); a question for the owner is recorded, not sent.
export async function reportWordsFromInsights(restaurant: Restaurant, reportMonday: string): Promise<InsightsOutput | null> {
  try {
    const { outcome, ms } = await runInsightsFor(restaurant, { task: "report", today: reportMonday }, "the Monday report (live)");
    const key = `insights:report:${reportMonday}:${Date.now()}`;
    await recordAgentRun({
      restaurantId: restaurant.id,
      key,
      agent: "insights",
      kind: "insights_live",
      trigger: "monday_report",
      output: { outcome: outcome.kind, revisions: outcome.revisions, steps: outcome.steps, ms, text: outcome.kind === "reply" ? insightsText(outcome.output) : outcome.question },
      agentVersion: outcome.agentVersion,
      verdict: outcome.kind === "reply" ? outcome.checker.verdict : "question",
      usage: outcome.usage,
    });
    return outcome.kind === "reply" ? outcome.output : null;
  } catch (err) {
    console.error("Insights couldn't write the report words; keeping today's", err);
    return null;
  }
}

