// The GM in shadow with a stand-in Claude: every owner message gets the router's
// route logged next to today's (a simple question also gets the composer's checked
// reply); each brief gets the composer's version (5 cards at most, ranked by code);
// the switch and its checklist; and the comparison tab.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });
const ownerPass = passOn(["F1", "F2", "F3", "F4", "F5", "C6"]);
const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "Owner's ask", language: "English", question: null, options: [], ...extra });

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
beforeEach(() => {
  vi.resetModules();
  answers = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: {}, owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", owner_name: "Bilal", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: { Sunday: "12:00 – 22:00" }, special_hours: {}, menu: [], signup_reward: "A free Mango Lassi", profile_version: 1,
        sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null,
      },
    ],
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], sales_days: [], reviews: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
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
            return { stop_reason: "end_turn", content: [], parsed_output: next, usage: { input_tokens: 500, output_tokens: 50 }, model: "claude-haiku-5-5" };
          },
        },
      },
    }),
  }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;

describe("every owner message", () => {
  test("the router's route is logged next to what today's code did", async () => {
    const { queueGmShadow } = await import("@/lib/agents/gm");
    await queueGmShadow(restaurant(), { message: "Thursday is quiet", owner: OWNER, legacy_route: "growth", legacy_text: "(drafted an email campaign)", legacy_ms: 6400, on_screen: null });
    answers = [route("growth")];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ agent: "gm", source: "owner_message", task: "growth", output: { route: "growth", reply: null }, subject: { message: "Thursday is quiet", legacy_route: "growth", legacy_ms: 6400 } });
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "gm_shadow", status: "done", verdict: "same" });
  });

  test("a simple profile question: the composer's reply, checked because it has facts", async () => {
    const { queueGmShadow } = await import("@/lib/agents/gm");
    await queueGmShadow(restaurant(), { message: "what time do we open on sunday?", owner: OWNER, legacy_route: "chat", legacy_text: "We open at 12pm on Sundays.", legacy_ms: 3100, on_screen: null });
    answers = [route("profile_question"), { type: "reply", message: "We open at 12pm on Sunday, Bilal." }, ownerPass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ task: "profile_question", output: { reply: "We open at 12pm on Sunday, Bilal." }, checker: { verdict: "pass" } });
    expect(db.tables.agent_jobs[0]).toMatchObject({ verdict: "different" });
  });

  test("with the GM off, nothing is logged", async () => {
    db.tables.restaurants[0].agent_modes = { gm: "off" };
    const { queueGmShadow } = await import("@/lib/agents/gm");
    expect(await queueGmShadow(restaurant(), { message: "hi", owner: OWNER, legacy_route: "chat", legacy_text: "Hi!", legacy_ms: 900, on_screen: null })).toBeNull();
  });
});

describe("the morning brief", () => {
  test("the composer's brief: a summary and at most 5 cards, ranked by code; the rest roll to tomorrow", async () => {
    const draft = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({ id, restaurant_id: A, kind: "google_post", content: `Post ${id}`, audience: "Google listing", request: null, status: "pending", created_at, ...extra });
    db.tables.drafts.push(
      draft("d1", "2026-10-01T09:00:00Z"),
      draft("d2", "2026-10-02T09:00:00Z"),
      draft("d3", "2026-10-03T09:00:00Z"),
      draft("d4", "2026-10-04T09:00:00Z"),
      draft("d5", "2026-10-05T09:00:00Z"),
      draft("d6", "2026-10-06T09:00:00Z", { kind: "review_reply", request: "Review check: low rating alert", audience: "Google review by Sara K" }),
    );
    const { queueGmBriefShadow } = await import("@/lib/agents/gm");
    await queueGmBriefShadow(restaurant(), { legacy_text: "☀️ Good morning! 6 things need your OK", draft_ids: ["d1", "d2", "d3", "d4", "d5", "d6"], receipts: ["replied to 2 reviews"], extra: [], today: "2026-10-12" });
    answers = [{ type: "brief", message: "Morning Bilal. Since yesterday: replied to 2 reviews. 5 things need a yes today." }, ...Array.from({ length: 5 }, (_, i) => ({ type: "card", message: `Card ${i + 1}` }))];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    const row = db.tables.shadow_drafts[0];
    expect(row).toMatchObject({ source: "brief", legacy_text: "☀️ Good morning! 6 things need your OK" });
    // The low-rating reply is urgent, so it comes first; the newest post rolls to tomorrow.
    expect((row.output as { cards: { draft_id: string }[] }).cards.map((c) => c.draft_id)).toEqual(["d6", "d1", "d2", "d3", "d4"]);
    expect((row.output as { rolled: string[] }).rolled).toEqual(["d5"]);
  });
});

describe("the switch and its checklist", () => {
  test("live needs test mode, the owner's name, language and quiet hours, and a specialist live", async () => {
    db.tables.restaurants[0].agent_modes = { gm: "live" };
    const { gmMode, gmChecklist } = await import("@/lib/agents/gm");
    vi.stubEnv("TEST_MODE", "true");
    expect(await gmMode(restaurant())).toBe("shadow");
    expect((await gmChecklist(restaurant())).labels).toEqual(["at least one specialist live"]);
    // Insights live (a demo's dummy sales count in test mode).
    db.tables.restaurants[0].agent_modes = { gm: "live", insights: "live" };
    db.tables.sales_days = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 1).padStart(2, "0")}`, source: "seed" }));
    expect(await gmMode(restaurant())).toBe("live");
    vi.stubEnv("TEST_MODE", "false");
    expect(await gmMode(restaurant())).toBe("shadow");
    db.tables.restaurants[0].owner_name = null;
    vi.stubEnv("TEST_MODE", "true");
    expect((await gmChecklist(restaurant())).labels).toEqual(["your name"]);
  });
});

test("the comparison shows the message, today's route and reply, the GM's route and the times", async () => {
  db.tables.shadow_drafts.push({
    id: "s1", restaurant_id: A, agent: "gm", source: "owner_message", task: "profile_question", review: null,
    subject: { message: "what time do we open on sunday?", legacy_route: "chat", legacy_ms: 3100, router_ms: 1200, compose_ms: 1800 },
    legacy_draft_id: null, legacy_text: "We open at 12pm on Sundays.", outcome: "reply", output: { route: "profile_question", reply: "We open at 12pm on Sunday, Bilal." }, question: null, checker: { verdict: "pass", checks: [], minor_fixes: [] },
    revisions: 0, steps: [], agent_version: "0.2", checker_version: "0.3", created_at: "2026-10-12T10:00:00Z",
  });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgentCompare } = await import("@/app/log/agent-compare");
  const html = renderToStaticMarkup(await AgentCompare({ restaurantId: A, agent: "gm" }));
  expect(html).toContain("The owner wrote");
  expect(html).toContain("what time do we open on sunday?");
  expect(html).toContain("Route: the composer (answered from the profile)");
  expect(html).toContain("today: general chat and look-ups");
  expect(html).toContain("Routing 1.2s + reply 1.8s · today&#x27;s reply took 3.1s");
});
