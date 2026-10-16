// Growth with the database and a stand-in Claude: owner requests, the Monday plan
// and calendar dates in shadow mode (saved next to today's work for /log), the
// switch and its go-live checklist, live drafts saved as real campaigns with their
// offer's fields, and the comparison tab.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const MENU = [
  { category: "Grills", items: [{ name: "Mixed Grill Platter", price: 18.5, description: null }] },
  { category: "Drinks", items: [{ name: "Mango Lassi", price: 3.5, description: null }] },
];
const CUSTOMER_CHECKS = ["T1", "T2", "T3", "T4", "T5", "F1", "F2", "F3", "F4", "F5", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "B1", "B2", "B3", "B4"];
const pass = { verdict: "pass", checks: CUSTOMER_CHECKS.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" };
const campaign = (extra: Record<string, unknown> = {}) => ({
  type: "campaign",
  channel: "email",
  name: "Quiet Thursday mango treat",
  segment: "everyone",
  audience_size: 2,
  send_at: "2026-10-14T10:00",
  template: "offer",
  photo_id: null,
  content: { subject: "A Thursday treat at Ember & Spice", headline: "Free Mango Lassi this Thursday", body: "Come in this Thursday from 5pm for a free Mango Lassi with any Mixed Grill Platter.", cta: "Book a table" },
  offer: { type: "free_item", description: "Free Mango Lassi with any Mixed Grill Platter", items: ["Mango Lassi", "Mixed Grill Platter"], applies_to: "Mixed Grill Platter", discount_percent: null, discount_value_gbp: 3.5, valid_from: "2026-10-15", valid_to: "2026-10-15", conditions: "Dine-in only, one per table" },
  idea: null,
  expected_outcome: "First campaign of this kind, no baseline yet.",
  needs_owner_input: null,
  sources_used: ["profile:menu", "segment:everyone"],
  ...extra,
});
const customer = (id: string) => ({ id, restaurant_id: A, name: `Customer ${id}`, email: `${id}@real.test`, birthday: null, marketing_opt_in: true, unsubscribed_at: null, source: "signup", email_confirmed_at: "2026-09-01T10:00:00Z", deleted_at: null });

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:30:00Z"));
  answers = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: {}, owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", trust_levels: {}, menu: MENU, opening_hours: { Thursday: "12:00 – 23:00" }, special_hours: {}, photo_library: [],
        profile_version: 1, discount_cap_percent: 20, signup_reward: "A free Mango Lassi", approved_offer_types: ["free_item", "percent_off"], birthday_offer: null, send_window_start: "09:00:00", send_window_end: "21:00:00",
        brand_color: "#123456", brand_dark: "#1c1917", logo_url: "https://x.test/logo.png", emoji_allowed: { campaigns: 2 }, words_to_avoid: [], halal_statement: "All our meat is halal.",
      },
    ],
    customers: [customer("c1"), customer("c2")], rewards: [], campaigns: [], campaign_sends: [], local_calendar: [], sales_days: [], sales_hours: [], sales_items: [], weather_days: [], customer_events: [],
    agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], drafts: [], reviews: [], draft_feedback: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/google", () => ({ google: () => ({ mode: "dummy", listReviews: async () => [] }) }));
  vi.doMock("@/lib/bank-holidays", () => ({ bankHolidays: async () => [] }));
  vi.doMock("@/lib/agents/growth-preview", async (orig) => ({ ...(await orig<object>()), growthPreviewPng: async () => ({ media_type: "image/png", data: "AAAA" }) }));
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
            const next = answers.shift();
            if (next === undefined) throw new Error("No more stand-in answers");
            return { stop_reason: "end_turn", content: [], parsed_output: next, usage: { input_tokens: 1000, output_tokens: 200 }, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/google", "@/lib/bank-holidays", "@/lib/agents/growth-preview"]) vi.doUnmock(m);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;

describe("shadow mode", () => {
  test("an owner's ask: Growth's campaign and the checker's verdict are saved next to today's draft", async () => {
    const { queueGrowthShadow } = await import("@/lib/agents/growth");
    await queueGrowthShadow(restaurant(), { task: "owner_request", request: "Thursday is quiet", today: "2026-10-12", legacy_draft_id: "d1", legacy_text: "Today's campaign" }, "growth:request:1");
    answers = [{ drafts: [campaign()] }, pass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    expect((await runQueuedAgentJobs(A)).map((r) => r.status)).toEqual(["done"]);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ agent: "growth", source: "owner_request", legacy_text: "Today's campaign", outcome: "reply", subject: { request: "Thursday is quiet" } });
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "growth_shadow", status: "done", verdict: "pass" });
    // Nothing reached a customer or the owner: no campaign, no draft.
    expect(db.tables.campaigns).toEqual([]);
    expect(db.tables.drafts).toEqual([]);
  });

  test("an empty Monday plan is saved as 'nothing this week'", async () => {
    const { queueGrowthShadow } = await import("@/lib/agents/growth");
    await queueGrowthShadow(restaurant(), { task: "weekly_plan", today: "2026-10-12" }, "growth:plan:1");
    answers = [{ drafts: [] }];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ source: "weekly_plan", outcome: "none" });
  });

  // (A repeat is ignored by the job keys, which are unique in the database: tests/agents/jobs.test.ts.)
  test("Monday: the plan, each calendar date 2 to 3 weeks ahead, and special ideas are queued", async () => {
    db.tables.local_calendar.push(
      { id: "e1", restaurant_id: null, day: "2026-10-31", name: "Halloween", type: "local_event", date_uncertain: false, source: "builder" },
      { id: "e2", restaurant_id: null, day: "2026-12-25", name: "Christmas Day", type: "religious", date_uncertain: false, source: "builder" },
    );
    const { mondayGrowth } = await import("@/lib/agents/growth");
    await mondayGrowth(restaurant(), "2026-10-12");
    expect(db.tables.agent_jobs.map((j) => j.job_key).sort()).toEqual(["growth:calendar:2026-10-31:Halloween", "growth:ideas:2026-10-12", "growth:plan:2026-10-12"]);
  });

  test("with Growth off, nothing is queued", async () => {
    db.tables.restaurants[0].agent_modes = { growth: "off" };
    const { queueGrowthShadow, mondayGrowth } = await import("@/lib/agents/growth");
    expect(await queueGrowthShadow(restaurant(), { task: "owner_request", request: "x", today: "2026-10-12" })).toBeNull();
    expect(await mondayGrowth(restaurant(), "2026-10-12")).toEqual([]);
    expect(db.tables.agent_jobs).toEqual([]);
  });
});

describe("the switch and its checklist", () => {
  test("live needs the checklist (cap, offer types, sign-up offer, logo, colours) and test mode", async () => {
    // Starts with test mode off, whatever the machine running the tests has (Vercel has it on).
    vi.stubEnv("TEST_MODE", "false");
    db.tables.restaurants[0].agent_modes = { growth: "live" };
    const { growthMode } = await import("@/lib/agents/growth");
    expect(await growthMode(restaurant())).toBe("shadow");
    vi.stubEnv("TEST_MODE", "true");
    expect(await growthMode(restaurant())).toBe("live");
    db.tables.restaurants[0].approved_offer_types = [];
    expect(await growthMode(restaurant())).toBe("shadow");
  });

  test("AGENTS_LIVE_ALLOWED=true lets a ready Growth go live without TEST_MODE, and with EMAIL_REDIRECT off", async () => {
    const { emailRedirectSwitch } = await import("@/lib/switches");
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AGENTS_LIVE_ALLOWED", "true");
    vi.stubEnv("EMAIL_REDIRECT", "false");
    db.tables.restaurants[0].agent_modes = { growth: "live" };
    const { growthMode } = await import("@/lib/agents/growth");
    expect(await growthMode(restaurant())).toBe("live");
    expect(emailRedirectSwitch(process.env).on).toBe(false);
    // The readiness check still applies.
    db.tables.restaurants[0].approved_offer_types = [];
    expect(await growthMode(restaurant())).toBe("shadow");
  });

  test("the kill switch beats TEST_MODE and a ready, live restaurant", async () => {
    vi.stubEnv("TEST_MODE", "true");
    vi.stubEnv("AGENTS_LIVE_ALLOWED", "false");
    db.tables.restaurants[0].agent_modes = { growth: "live" };
    const { growthMode } = await import("@/lib/agents/growth");
    expect(await growthMode(restaurant())).toBe("shadow");
    // Off and shadow are left as they are.
    db.tables.restaurants[0].agent_modes = { growth: "off" };
    expect(await growthMode(restaurant())).toBe("off");
  });

  test("the owner is asked for what's missing in Growth's own words", async () => {
    const { goLivePromptText } = await import("@/lib/agents/go-live");
    expect(goLivePromptText(restaurant(), ["approved_offer_types"], "growth")).toMatch(/To draft offers and campaigns for you, I need your kinds of offer you're happy to run/);
  });
});

describe("live mode (test mode only)", () => {
  test("an owner's ask: Growth's campaign becomes a real draft with its offer's fields, for the owner to approve", async () => {
    vi.stubEnv("TEST_MODE", "true");
    db.tables.restaurants[0].agent_modes = { growth: "live" };
    answers = [{ drafts: [campaign()] }, pass];
    const sent: string[] = [];
    const { liveGrowthRequest } = await import("@/lib/agents/growth");
    expect(await liveGrowthRequest(restaurant(), "Thursday is quiet", new Date(), async (t) => void sent.push(t))).toBe(true);
    expect(db.tables.campaigns[0]).toMatchObject({ segment: "everyone", valid_from: "2026-10-15", offer_details: { type: "free_item", applies_to: "Mixed Grill Platter" } });
    expect(db.tables.drafts[0]).toMatchObject({ kind: "email_campaign", status: "pending" });
    expect(sent[0]).toContain("A Thursday treat at Ember & Spice");
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "growth_live", verdict: "pass" });
  });

  test("a question goes to the owner, and nothing is drafted", async () => {
    answers = [{ drafts: [campaign({ content: { subject: "", headline: "", body: "", cta: "" }, offer: null, needs_owner_input: "40% is over your 20% cap. Shall I do 20%?" })] }];
    const sent: string[] = [];
    const { liveGrowthRequest } = await import("@/lib/agents/growth");
    expect(await liveGrowthRequest(restaurant(), "40% off everything", new Date(), async (t) => void sent.push(t))).toBe(true);
    expect(sent).toEqual(["❓ 40% is over your 20% cap. Shall I do 20%?"]);
    expect(db.tables.campaigns).toEqual([]);
  });

  test("if Growth can't answer, today's campaign flow does", async () => {
    answers = [];
    const { liveGrowthRequest } = await import("@/lib/agents/growth");
    expect(await liveGrowthRequest(restaurant(), "Thursday is quiet", new Date(), async () => {})).toBe(false);
  });
});

test("the comparison shows the ask, today's draft, Growth's email with its picture, and the verdict", async () => {
  db.tables.shadow_drafts.push({
    id: "s1", restaurant_id: A, agent: "growth", source: "owner_request", task: "owner_request", review: null, subject: { request: "Thursday is quiet", today: "2026-10-12", ms: 30000 },
    legacy_draft_id: null, legacy_text: "*Quiet Thursday grill deal* 15% off all grills", outcome: "reply", output: campaign(), question: null, checker: pass, revisions: 0, steps: [], agent_version: "0.2", checker_version: "0.3", created_at: "2026-10-12T10:00:00Z",
  });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgentCompare } = await import("@/app/log/agent-compare");
  const html = renderToStaticMarkup(await AgentCompare({ restaurantId: A, agent: "growth" }));
  expect(html).toContain("The owner asked for an offer");
  expect(html).toContain("Thursday is quiet");
  expect(html).toContain("Quiet Thursday grill deal");
  expect(html).toContain("A Thursday treat at Ember &amp; Spice");
  expect(html).toContain("/log/growth-preview/s1");
  expect(html).toContain("Checker v0.3: pass");
});
