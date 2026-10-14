// Insights with the database and a stand-in Claude: owner number questions and the
// Monday report in shadow mode (saved next to today's words for /log), the switch
// and its go-live checklist (2+ weeks of sales data, test mode), live answers, and
// the comparison tab.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });
// Owner-only output: the facts checks and C6.
const pass = passOn(["F1", "F2", "F3", "F4", "F5", "C6"]);
const LAST_WEEK = { metric: "net_sales", period: "last_week", date: null, from: null, to: null, weekday: null, compare: "previous_period", campaign: null };
const answer = (extra: Record<string, unknown> = {}) => ({
  type: "answer",
  channel: "owner",
  content: { headline: "", body: "Last week took £7,000 net, the same as the week before (£7,000).", actions: [] },
  figures: [{ metric: "net_sales", value: 7000, unit: "GBP", period: "28 Sep to 4 Oct", compare_to: "the week before", compare_value: 7000, source: "metrics:q1" }],
  confidence: "high",
  needs_owner_input: null,
  sources_used: ["metrics:q1"],
  ...extra,
});

// 35 days of £1,000 net a day, up to Sunday 4 October.
const salesDays = (source: string) =>
  Array.from({ length: 35 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    return { id: `s${i}`, restaurant_id: A, day: d, net_sales: 1000, gross_sales: 1200, transactions: 50, source, net_estimated: false, is_dummy: source === "seed" };
  });

let db: ReturnType<typeof memoryDb>;
// Each stand-in answer: { tool: <query> } (a query_metrics call) or the agent's JSON.
let answers: unknown[];
let messages: { to: string; text: string }[];
beforeEach(() => {
  vi.resetModules();
  answers = [];
  messages = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: {}, owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", trust_levels: {},
        menu: [], opening_hours: { Monday: "12:00 – 23:00" }, special_hours: {}, photo_library: [], profile_version: 1, google_place_id: null, discount_cap_percent: 20,
      },
    ],
    sales_days: salesDays("seed"), sales_hours: [], sales_items: [], weather_days: [], customer_events: [], campaigns: [], campaign_sends: [], rewards: [], review_themes: [],
    agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], drafts: [], reviews: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/google", () => ({ google: () => ({ mode: "dummy", listReviews: async () => [] }) }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (channel: { to: string }, text: string) => void messages.push({ to: channel.to, text }) }));
  vi.doMock("@/lib/claude", () => ({
    MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
    MODEL: "claude-sonnet-5-5",
    MAX_TOKENS: 100,
    WITH_FALLBACK: {},
    fallbackFor: () => ({}),
    claude: () => ({
      beta: {
        messages: {
          parse: async () => {
            const next = answers.shift() as { tool?: unknown } | undefined;
            if (next === undefined) throw new Error("No more stand-in answers");
            const usage = { input_tokens: 1000, output_tokens: 200 };
            if (next.tool) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${answers.length}`, name: "query_metrics", input: next.tool }], parsed_output: null, usage, model: "claude-sonnet-5-5" };
            return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], parsed_output: next, usage, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/google", "@/lib/notify"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;

describe("shadow mode", () => {
  test("an owner's number question: Insights' answer, its queries and the checker's verdict are saved next to today's answer", async () => {
    const { queueInsightsShadow } = await import("@/lib/agents/insights");
    await queueInsightsShadow(restaurant(), { task: "answer", question: "how was last week?", today: "2026-10-05", legacy_text: "Today's answer" }, "insights:question:1");
    answers = [{ tool: LAST_WEEK }, answer(), pass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    expect((await runQueuedAgentJobs(A)).map((r) => r.status)).toEqual(["done"]);
    const row = db.tables.shadow_drafts[0];
    expect(row).toMatchObject({ agent: "insights", source: "owner_question", task: "answer", legacy_text: "Today's answer", outcome: "reply", revisions: 0 });
    expect((row.subject as { queries: { id: string; metric: string }[] }).queries.map((q) => [q.id, q.metric])).toEqual([["q1", "net_sales"]]);
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "insights_shadow", status: "done", verdict: "pass" });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "insights", action: "agent_drafted" });
    expect(messages).toEqual([]);
  });

  test("a figure Insights worked out itself is rejected; the corrected answer is the one saved", async () => {
    const { queueInsightsShadow } = await import("@/lib/agents/insights");
    await queueInsightsShadow(restaurant(), { task: "answer", question: "how was last week?", today: "2026-10-05", legacy_text: null }, "insights:question:2");
    const madeUp = answer({ content: { headline: "", body: "Last week took £7,050 net.", actions: [] }, figures: [{ ...answer().figures[0], value: 7050, compare_value: null }] });
    answers = [{ tool: LAST_WEEK }, madeUp, answer(), pass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect((db.tables.shadow_drafts[0].output as { content: { body: string } }).content.body).toContain("£7,000");
  });

  test("the Monday report: code's figures first, then Insights' words, saved next to today's report words", async () => {
    const { queueInsightsShadow, legacyReportText } = await import("@/lib/agents/insights");
    await queueInsightsShadow(restaurant(), { task: "report", today: "2026-10-05", report_id: "r1", legacy_text: legacyReportText("Steady week.", [{ title: "Post a dish", why: "Posts keep the listing fresh." }]) }, "insights:report:r1");
    const action = { title: "Fill the quietest day", why: "Every day took £1,000 last week.", message: "Monday is quiet, draft an offer" };
    answers = [
      answer({
        type: "report_section",
        content: { headline: "Last week took £7,000 net, the same as the week before.", body: "Sales were steady at £7,000.", actions: [action, action, action] },
        // q3 is the prepared sales by day.
        figures: [...answer().figures, { metric: "net_sales_day", value: 1000, unit: "GBP", period: "each day last week", compare_to: null, compare_value: null, source: "metrics:q3" }],
        sources_used: ["metrics:q1", "metrics:q3"],
      }),
      pass,
    ];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    const row = db.tables.shadow_drafts[0];
    expect(row).toMatchObject({ source: "monday_report", task: "report", outcome: "reply", legacy_text: "Steady week.\n1. Post a dish: Posts keep the listing fresh." });
    // The prepared figures were run before Insights wrote anything (q1 is last week's net sales).
    expect((row.subject as { queries: unknown[] }).queries.length).toBeGreaterThanOrEqual(10);
  });

  test("with Insights off, nothing is queued", async () => {
    db.tables.restaurants[0].agent_modes = { insights: "off" };
    const { queueInsightsShadow } = await import("@/lib/agents/insights");
    expect(await queueInsightsShadow(restaurant(), { task: "answer", question: "how was last week?", today: "2026-10-05" }, "k")).toBeNull();
    expect(db.tables.agent_jobs).toEqual([]);
  });
});

describe("the switch and its go-live checklist", () => {
  test("live needs 2+ weeks of sales data and test mode; a demo's dummy data only counts in test mode", async () => {
    // Starts with test mode off, whatever the machine running the tests has (Vercel has it on).
    vi.stubEnv("TEST_MODE", "false");
    db.tables.restaurants[0].agent_modes = { insights: "live" };
    const { insightsMode, insightsChecklist } = await import("@/lib/agents/insights");
    expect(await insightsMode(restaurant())).toBe("shadow");
    vi.stubEnv("TEST_MODE", "true");
    expect(await insightsMode(restaurant())).toBe("live");
    expect((await insightsChecklist(restaurant())).ready).toBe(true);
    db.tables.restaurants[0].is_demo = false;
    expect(await insightsChecklist(restaurant())).toMatchObject({ ready: false, days: 0 });
    expect(await insightsMode(restaurant())).toBe("shadow");
    db.tables.sales_days = salesDays("z_report").slice(0, 14);
    expect(await insightsMode(restaurant())).toBe("live");
    db.tables.sales_days = salesDays("pos").slice(0, 13);
    expect(await insightsMode(restaurant())).toBe("shadow");
  });

  test("the builder can't save it as live while the checklist fails", async () => {
    db.tables.restaurants[0].is_demo = false;
    const { goLiveChecklistFor } = await import("@/lib/agents/go-live");
    const result = await goLiveChecklistFor(restaurant(), "insights");
    expect(result.ready).toBe(false);
    expect(result.labels.join(" ")).toMatch(/2\+ weeks of sales data .* \(0 days so far\)/);
  });
});

describe("live mode (test mode only)", () => {
  test("Insights answers the owner's question straight away, and it's recorded", async () => {
    vi.stubEnv("TEST_MODE", "true");
    const sent: string[] = [];
    answers = [{ tool: LAST_WEEK }, answer(), pass];
    const { answerWithInsights } = await import("@/lib/agents/insights");
    expect(await answerWithInsights(restaurant(), "how was last week?", new Date("2026-10-05T10:00:00Z"), async (t) => void sent.push(t))).toBe(true);
    expect(sent).toEqual(["📊 Last week took £7,000 net, the same as the week before (£7,000)."]);
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "insights_live", status: "done", verdict: "pass" });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "insights", action: "agent_drafted" });
  });

  test("if Insights can't answer, it says so and today's assistant answers instead", async () => {
    answers = [];
    const { answerWithInsights } = await import("@/lib/agents/insights");
    const sent: string[] = [];
    expect(await answerWithInsights(restaurant(), "how was last week?", new Date("2026-10-05T10:00:00Z"), async (t) => void sent.push(t))).toBe(false);
    expect(sent).toEqual([]);
  });
});

test("the comparison shows the question, today's answer, Insights' answer with its figures, and the verdict", async () => {
  db.tables.shadow_drafts.push({
    id: "s1", restaurant_id: A, agent: "insights", source: "owner_question", task: "answer", review: null,
    subject: { question: "how was last week?", today: "2026-10-05", ms: 14000, queries: [{ id: "q1", metric: "net_sales", available: true }] },
    legacy_draft_id: null, legacy_text: "I don't have your sales figures.", outcome: "reply", output: answer(), question: null, checker: pass,
    revisions: 0, steps: [], agent_version: "0.2", checker_version: "0.3", created_at: "2026-10-12T10:00:00Z",
  });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgentCompare } = await import("@/app/log/agent-compare");
  const html = renderToStaticMarkup(await AgentCompare({ restaurantId: A, agent: "insights" }));
  expect(html).toContain("The owner asked");
  expect(html).toContain("how was last week?");
  expect(html).toContain("I don&#x27;t have your sales figures.");
  expect(html).toContain("Last week took £7,000 net");
  expect(html).toContain("net_sales: 7000 GBP");
  expect(html).toContain("Checker v0.3: pass");
  expect(html).toContain("Took 14s");
});

describe("on WhatsApp", () => {
  async function ask(body: string) {
    const sent: string[] = [];
    vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), chat: async () => ({ type: "text", text: "Today's answer" }) }));
    vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), getActiveDraft: async () => null, getLearningContext: async () => ({ feedback: [], approved: [] }) }));
    const { handleConversation } = await import("@/lib/bot/conversation");
    const ctx = { restaurantId: A, restaurant: restaurant(), now: new Date("2026-10-05T10:00:00Z") };
    await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: "whatsapp:+14155238886", to: OWNER }, send: async (t: string) => void sent.push(t) } as never, body, undefined);
    vi.doUnmock("@/lib/assistant");
    vi.doUnmock("@/lib/drafts");
    return sent;
  }

  test("a number question gets today's answer, and Insights is queued in the background with it", async () => {
    db.tables.messages = [];
    expect(await ask("how was last week?")).toEqual(["Today's answer"]);
    const insightsJobs = db.tables.agent_jobs.filter((j) => j.kind === "insights_shadow");
    expect(insightsJobs).toHaveLength(1);
    expect(insightsJobs[0]).toMatchObject({ kind: "insights_shadow", trigger: "owner_question", input: { task: "answer", question: "how was last week?", today: "2026-10-05", legacy_text: "Today's answer" } });
  });

  test("anything else isn't sent to Insights", async () => {
    db.tables.messages = [];
    expect(await ask("Thursday is quiet")).toEqual(["Today's answer"]);
    expect(db.tables.agent_jobs.filter((j) => j.kind === "insights_shadow")).toEqual([]);
    // The GM (shadow) logs its route for every message.
    expect(db.tables.agent_jobs.map((j) => j.kind)).toEqual(["gm_shadow"]);
  });

  test("live (test mode): Insights answers instead of today's assistant", async () => {
    vi.stubEnv("TEST_MODE", "true");
    db.tables.restaurants[0].agent_modes = { insights: "live" };
    db.tables.messages = [];
    answers = [{ tool: LAST_WEEK }, answer(), pass];
    expect(await ask("how was last week?")).toEqual(["📊 Last week took £7,000 net, the same as the week before (£7,000)."]);
  });
});
