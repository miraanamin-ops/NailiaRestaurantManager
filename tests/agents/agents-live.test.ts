// The agents live and the old assistant retired (docs/pilot-sprint.md, "Agents
// live"): with a restaurant on the agents, the old assistant never answers (chat
// and look-ups are the composer's, a typed change goes to the draft on screen, a
// review the owner means is found), the release gate needs the checker's pass on
// a Google write's exact version, and Insights reads the week ahead and staff costs.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { agentModesFor } from "@/lib/agents/assistant-mode";
import { googleCheckerStep } from "@/lib/gate-rules";
import { asksAboutReviews, pickReview, starsMentioned, waitingReviewsText } from "@/lib/agents/gm-review-rules";
import { queryMetrics, type MetricsData, type MetricQueryInput } from "@/lib/agents/insights-metrics";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });
const ownerPass = passOn(["F1", "F2", "F3", "F4", "F5", "C6"]);
const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "Owner's ask", language: "English", question: null, options: [], pasted_review: null, ...extra });

describe("the release gate and the checker", () => {
  const live = { kind: "review_reply", checkerLive: true, version: 2 };
  test("with the checker live, a Google reply or post needs its pass on that exact version", () => {
    expect(googleCheckerStep({ ...live, agentCheck: { mode: "live", verdict: "pass", draft_version: 2 } })).toEqual({ outcome: "ok" });
    // Edited since it was checked, never checked, or only checked in shadow: check it now.
    expect(googleCheckerStep({ ...live, agentCheck: { mode: "live", verdict: "pass", draft_version: 1 } })).toEqual({ outcome: "check_now" });
    expect(googleCheckerStep({ ...live, agentCheck: null })).toEqual({ outcome: "check_now" });
    expect(googleCheckerStep({ ...live, agentCheck: { mode: "shadow", verdict: "pass", draft_version: 2 } })).toEqual({ outcome: "check_now" });
    const failed = googleCheckerStep({ ...live, kind: "google_post", agentCheck: { mode: "live", verdict: "fail", draft_version: 2, notes: "The post names a dish that isn't on the menu." } });
    expect(failed.outcome).toBe("blocked");
    expect(failed.outcome === "blocked" && failed.detail).toMatch(/didn't pass.*isn't on the menu/);
    expect(googleCheckerStep({ ...live, agentCheck: { mode: "live", verdict: "escalate", draft_version: 2 } }).outcome).toBe("blocked");
  });

  test("the old assistant (checker in shadow) and code's own Google wording are unchanged", () => {
    expect(googleCheckerStep({ ...live, checkerLive: false, agentCheck: null })).toEqual({ outcome: "ok" });
    expect(googleCheckerStep({ ...live, kind: "hours_update", agentCheck: null })).toEqual({ outcome: "ok" });
    expect(googleCheckerStep({ ...live, kind: "email_campaign", agentCheck: null })).toEqual({ outcome: "ok" });
  });
});

describe("which review the owner means", () => {
  const reviews = [
    { id: "r1", author_name: "Tom Reed", rating: 2, review_date: "2026-10-26T10:00:00Z", replied: false },
    { id: "r2", author_name: "Aisha K.", rating: 5, review_date: "2026-10-25T10:00:00Z", replied: false },
    { id: "r3", author_name: "Sam", rating: 2, review_date: "2026-10-20T10:00:00Z", replied: true },
    { id: "r4", author_name: "Priya", rating: 4, review_date: "2026-10-27T08:00:00Z", replied: true },
  ];
  test("stars in any common form", () => {
    expect(starsMentioned("reply to the 2 star one")).toBe(2);
    expect(starsMentioned("the two-star review")).toBe(2);
    expect(starsMentioned("that 1* review")).toBe(1);
    expect(starsMentioned("the ⭐⭐⭐ one")).toBe(3);
    expect(starsMentioned("reply to Tom")).toBeNull();
  });
  test("a named reviewer first, then the stars, newest not-yet-replied first", () => {
    expect(pickReview("reply to the 2 star one from yesterday", reviews)?.id).toBe("r1");
    expect(pickReview("answer Aisha's review", reviews)?.id).toBe("r2");
    expect(pickReview("reply to sam", reviews)?.id).toBe("r3");
    expect(pickReview("reply to the latest review", reviews)?.id).toBe("r1");
    expect(pickReview("reply to the 3 star one", reviews)).toBeNull();
  });
  test("a question about the reviews gets the list, a request gets a reply", () => {
    expect(asksAboutReviews("which reviews still need a reply?")).toBe(true);
    expect(asksAboutReviews("any new reviews")).toBe(true);
    expect(asksAboutReviews("reply to the 2 star one")).toBe(false);
    expect(asksAboutReviews("can you reply to Tom's review?")).toBe(false);
    const text = waitingReviewsText(reviews);
    expect(text).toMatch(/^2 reviews are waiting for a reply/);
    expect(text).toContain("Tom Reed, 2 stars");
    expect(text).toContain("Say _reply to Tom_");
    expect(waitingReviewsText([])).toMatch(/Every review has a reply/);
  });
});

describe("Insights: the week ahead and staff costs", () => {
  // Today is Wednesday 28 October; this week runs Mon 26 Oct to Sun 1 Nov.
  const day = (date: string, mid: number) => ({ date, orders: Math.round(mid / 20), sales_low: mid * 0.9, sales_mid: mid, sales_high: mid * 1.1 });
  const week = (start: string, mids: number[]) => mids.map((m, i) => day(new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), m));
  const data = (over: Partial<MetricsData> = {}): MetricsData => ({
    today: "2026-10-28",
    sales_days: [
      { day: "2026-10-26", net: 1200, gross: null, transactions: 60, source: "seed" },
      { day: "2026-10-27", net: 1100, gross: null, transactions: 55, source: "seed" },
    ],
    sales_hours: [], sales_items: [], weather: [], reviews: [], signups: [], campaigns: [], sends: [], rewards: [],
    forecast_weeks: [
      { week_start: "2026-10-26", status: "ok", unvalidated: false, source: "history", error_pct: 9, limit_pct: 20, days: week("2026-10-26", [1000, 1000, 1300, 1500, 2400, 2700, 1900]) },
      { week_start: "2026-11-02", status: "ok", unvalidated: false, source: "history", error_pct: 9, limit_pct: 20, days: week("2026-11-02", [1250, 1150, 1300, 1550, 2350, 2650, 1950]) },
    ],
    labour_weeks: [
      { week_start: "2026-10-26", status: "approved", cost: 2900, hours: 230, by_day: { "2026-10-26": 300, "2026-10-27": 300, "2026-10-28": 350, "2026-10-29": 400, "2026-10-30": 550, "2026-10-31": 600, "2026-11-01": 400 }, missing_rates: 0 },
      { week_start: "2026-11-02", status: "draft", cost: 3010, hours: 240, by_day: { "2026-11-02": 320, "2026-11-03": 300, "2026-11-04": 350, "2026-11-05": 420, "2026-11-06": 560, "2026-11-07": 640, "2026-11-08": 420 }, missing_rates: 0 },
    ],
    labour_target_pct: 28,
    ...over,
  });
  const q = (over: Partial<MetricQueryInput>): MetricQueryInput => ({ metric: "sales_forecast", period: "next_week", date: null, from: null, to: null, weekday: null, compare: "none", campaign: null, ...over });

  test("next week's forecast: the likely total, its range and each day", () => {
    const r = queryMetrics(data(), q({}), "m1");
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.period).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(r.value?.display).toBe("£12,200");
    expect(r.rows.find((x) => x.label.startsWith("Whole period: likely range, low end"))?.display).toBe("£10,980");
    expect(r.rows).toHaveLength(9);
  });

  test("this week's forecast only counts the days still to come", () => {
    const r = queryMetrics(data(), q({ period: "this_week" }), "m2");
    if (!r.available) throw new Error("expected figures");
    expect(r.days_with_data).toBe(5);
    expect(r.notes.join(" ")).toMatch(/2 days are already past/);
  });

  test("no numbers under 8 weeks of history, or when the forecast is held back", () => {
    const thin = queryMetrics(data({ forecast_weeks: data().forecast_weeks!.map((w) => ({ ...w, status: "not_enough_history" as const })) }), q({}), "m3");
    expect(thin).toMatchObject({ available: false, missing: "enough sales history for a forecast" });
    const held = queryMetrics(data({ forecast_weeks: data().forecast_weeks!.map((w) => ({ ...w, status: "held_back" as const, error_pct: 31 })) }), q({}), "m4");
    expect(held.available).toBe(false);
    expect(!held.available && held.how_to_get).toMatch(/31% on average, over the 20% limit/);
  });

  test("what staff will cost next week: the rota's cost, as a % of forecast sales, and the target", () => {
    const r = queryMetrics(data(), q({ metric: "labour_cost" }), "m5");
    if (!r.available) throw new Error("expected figures");
    expect(r.value?.display).toBe("£3,010");
    expect(r.rows.find((x) => x.label.startsWith("Labour as a %"))?.display).toBe("25%");
    expect(r.rows.find((x) => x.label.startsWith("The owner's labour target"))?.display).toBe("28%");
    expect(r.notes.join(" ")).toMatch(/draft rota/);
    expect(r.notes.join(" ")).toMatch(/forecast's likely sales/);
  });

  test("this week's staff cost uses real takings for days gone", () => {
    const r = queryMetrics(data(), q({ metric: "labour_cost", period: "this_week" }), "m6");
    if (!r.available) throw new Error("expected figures");
    const monday = r.rows.find((x) => x.label.startsWith("Mon 26 Oct"));
    expect(monday?.extra).toMatchObject({ sales_kind: "actual", sales: { display: "£1,200" } });
  });

  test("no team or no rota: says what's missing and how to get it", () => {
    expect(queryMetrics(data({ labour_weeks: null }), q({ metric: "labour_cost" }), "m7")).toMatchObject({ available: false, missing: "staff costs (the rota)" });
    expect(queryMetrics(data({ labour_weeks: [] }), q({ metric: "labour_cost" }), "m8")).toMatchObject({ available: false, missing: "a rota for that period" });
  });
});

// ---------- The conversation, on the agents ----------

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let sent: { text: string; buttons: unknown }[];
const oldAssistant = vi.fn(async () => ({ type: "text", text: "The old assistant's answer" }));
const reviseAndSend = vi.fn(async () => {});
const pastedReviewReply = vi.fn(async () => {});
const alerts: string[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  sent = [];
  alerts.length = 0;
  oldAssistant.mockClear();
  reviseAndSend.mockClear();
  pastedReviewReply.mockClear();
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Test Kitchen", slug: "test-kitchen", is_demo: true, active: true, agent_modes: agentModesFor("agents", {}), owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", owner_name: "Bilal", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: { Friday: "14:00 – 00:00" }, special_hours: {}, signup_reward: "A free Mango Lassi", profile_version: 1,
        menu: [{ category: "Grills", items: [{ name: "Lamb Chops (4 pcs)", price: 13.95, description: null }] }], discount_cap_percent: 20, trust_levels: {},
        // What Reputation needs to go live (its checklist).
        sign_off_name: "Bilal", complaint_contact: "020 7946 0000", recovery_offers: ["a free dessert next visit"], halal_statement: "All our meat is halal.", allergen_statement: "Ask staff about allergens.", paused: false, fake_now: null,
        send_window_start: "09:00", send_window_end: "21:00",
      },
    ],
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 1).padStart(2, "0")}`, source: "seed" })),
    reviews: [
      { id: "g1", restaurant_id: A, author_name: "Tom Reed", rating: 2, text: "Cold naan.", review_date: "2026-10-11T10:00:00Z", replied: false, reply_text: null, reply_posted_at: null, handled_at: "2026-10-11T11:00:00Z", source: "dummy" },
    ],
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], draft_feedback: [], builder_alerts: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => void alerts.push(m) ?? "ok" }));
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
  vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), chat: oldAssistant, rewriteDraft: async () => "A shorter reply." }));
  vi.doMock("@/lib/bot/flows", async (orig) => ({ ...(await orig<object>()), reviseAndSend, pastedReviewReply }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/assistant", "@/lib/bot/flows"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
});

async function say(body: string, buttonPayload?: string) {
  const { handleConversation } = await import("@/lib/bot/conversation");
  const restaurant = { ...db.tables.restaurants[0] };
  const ctx = { restaurantId: A, restaurant, restaurantName: restaurant.name, now: new Date("2026-10-12T10:00:00Z"), today: "Monday 12 October 2026", reviews: db.tables.reviews, customers: [] };
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });
  await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: "whatsapp:+14155238886", to: OWNER }, send } as never, body, buttonPayload);
}

describe("on the agents, the old assistant never answers", () => {
  test("general chat: the composer answers from the data it's given, checked", async () => {
    answers = [route("chat"), { type: "reply", message: "You're welcome, Bilal. One review is waiting for a reply." }, ownerPass];
    await say("thanks!");
    expect(sent.map((s) => s.text)).toEqual(["You're welcome, Bilal. One review is waiting for a reply."]);
    expect(oldAssistant).not.toHaveBeenCalled();
    expect(db.tables.agent_jobs.map((j) => j.kind)).toEqual(["gm_live", "gm_chat"]);
  });

  test("the router fails: one honest line, and the builder is told (with the command to switch back)", async () => {
    answers = [];
    await say("how was last week?");
    expect(oldAssistant).not.toHaveBeenCalled();
    expect(sent.map((s) => s.text)).toEqual([expect.stringMatching(/^Sorry, I couldn't do that one just now/)]);
    expect(alerts[0]).toMatch(/scripts\/assistant-mode\.mjs test-kitchen old/);
  });

  test("a chat reply the checker doesn't pass isn't sent", async () => {
    answers = [route("chat"), { type: "reply", message: "You have 9 customers." }, { ...ownerPass, verdict: "fail", checks: ownerPass.checks.map((c) => (c.id === "F1" ? { id: "F1", result: "fail", reason: "1 is waiting, not 9", fix: "say 1" } : c)) }];
    await say("how many customers have we got?");
    expect(oldAssistant).not.toHaveBeenCalled();
    expect(sent.map((s) => s.text)).toEqual([expect.stringMatching(/^Sorry/)]);
  });

  test("on the old assistant (the one-command fallback), it answers as before", async () => {
    db.tables.restaurants[0].agent_modes = agentModesFor("old", db.tables.restaurants[0].agent_modes);
    await say("thanks!");
    expect(sent.map((s) => s.text)).toEqual(["The old assistant's answer"]);
  });
});

describe("the GM's new routes", () => {
  test("a typed change to the draft on screen goes to the same rewrite as Edit", async () => {
    db.tables.drafts.push({ id: "d1", restaurant_id: A, kind: "other", status: "pending", waiting_for: "decision", content: "A long notice.", audience: "staff", version: 1, created_at: "2026-10-12T09:00:00Z" });
    answers = [route("edit")];
    await say("make it shorter");
    expect(reviseAndSend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "d1" }), "make it shorter", "A shorter reply.", expect.any(Function));
    expect(oldAssistant).not.toHaveBeenCalled();
  });

  test("a pasted review: its details from the router go to Reputation's copy-and-paste reply", async () => {
    answers = [route("reputation", { pasted_review: { author_name: "Jo", rating: null, text: "Lovely lamb chops, slow service." } })];
    await say("can you reply to this 4 star review from Jo: Lovely lamb chops, slow service.");
    expect(pastedReviewReply).toHaveBeenCalledWith(expect.anything(), { authorName: "Jo", rating: 4, text: "Lovely lamb chops, slow service." }, expect.any(Function));
  });

  test("'reply to the 2 star one': a reply already drafted comes back on screen", async () => {
    db.tables.drafts.push({ id: "d2", restaurant_id: A, kind: "review_reply", status: "pending", waiting_for: null, content: "Sorry about the naan, Tom.", audience: "Google review by Tom Reed", review_id: "g1", version: 1, created_at: "2026-10-11T11:00:00Z" });
    answers = [route("reputation")];
    await say("reply to the 2 star one");
    expect(db.tables.drafts.find((d) => d.id === "d2")).toMatchObject({ waiting_for: "decision" });
    expect(sent.at(-1)!.text).toContain("Sorry about the naan, Tom.");
    expect(sent.at(-1)!.buttons).toBe(true);
  });
});

describe("the release gate, end to end", () => {
  // An edited Google reply (version 2; the checker last passed version 1), approved.
  function editedReply() {
    db.tables.drafts.push({
      id: "d3", restaurant_id: A, kind: "review_reply", status: "approved", approved_at: "2026-10-12T10:00:00Z", sent_at: null, scheduled_for: null, waiting_for: null,
      content: "Sorry about the naan, Tom. Come back for a free dessert.", audience: "Google review by Tom Reed", review_id: "g1", version: 2, checks: {},
      agent_check: { mode: "live", verdict: "pass", draft_version: 1 }, created_at: "2026-10-11T11:00:00Z",
    });
  }
  function checkerSays(verdict: "pass" | "fail") {
    const calls: number[] = [];
    vi.doMock("@/lib/agents/checker", () => ({
      checkDraftVersion: vi.fn(async (draft: { id: string }, version: number, mode: string, jobId: string) => {
        calls.push(version);
        const agentCheck = { mode, job_id: jobId, agent_version: "0.3", draft_version: version, verdict, checks: [], minor_fixes: [], owner_question: null, notes: verdict === "fail" ? "A free dessert isn't one of the restaurant's recovery offers." : "", at: "2026-10-12T11:00:00Z" };
        Object.assign(db.tables.drafts.find((d) => d.id === draft.id)!, { agent_check: agentCheck });
        return { agentCheck, result: { agentVersion: "0.3", usage: { checker: { input: 900, output: 80, cacheRead: 0, cacheWrite: 0, cost: 0.0026 } } }, profileVersion: 1 };
      }),
    }));
    return calls;
  }
  afterEach(() => vi.doUnmock("@/lib/agents/checker"));

  test("an owner's edit is checked by the checker before it goes; a fail is never posted", async () => {
    editedReply();
    const calls = checkerSays("fail");
    const { attemptSend } = await import("@/lib/send");
    const result = await attemptSend("d3", db.tables.restaurants[0] as never, new Date("2026-10-12T11:00:00Z"), "approve");
    expect(calls).toEqual([2]);
    expect(result).toMatchObject({ outcome: "blocked", reason: "checker" });
    expect(result.outcome === "blocked" && result.detail).toMatch(/recovery offers/);
    expect(db.tables.reviews[0].reply_text).toBeNull();
    expect(db.tables.drafts[0]).toMatchObject({ status: "blocked" });
    expect(db.tables.agent_jobs.map((j) => j.kind)).toEqual(["checker_live"]);
  });

  test("a pass on the edited version: it goes to (dummy) Google", async () => {
    editedReply();
    const calls = checkerSays("pass");
    const { attemptSend } = await import("@/lib/send");
    const result = await attemptSend("d3", db.tables.restaurants[0] as never, new Date("2026-10-12T11:00:00Z"), "approve");
    expect(calls).toEqual([2]);
    expect(result.outcome).toBe("sent");
  });

  test("on the old assistant (checker in shadow), the gate doesn't ask the checker", async () => {
    db.tables.restaurants[0].agent_modes = agentModesFor("old", {});
    editedReply();
    const calls = checkerSays("fail");
    const { attemptSend } = await import("@/lib/send");
    expect((await attemptSend("d3", db.tables.restaurants[0] as never, new Date("2026-10-12T11:00:00Z"), "approve")).outcome).toBe("sent");
    expect(calls).toEqual([]);
  });
});

describe("the halal word rule and place names", () => {
  test("West Ham and East Ham are names, not the meat; ham still is", async () => {
    const { textRules } = await import("@/lib/agents/visibility-rules");
    const profile = { halal_statement: "All our meat is halal.", words_to_avoid: [] } as never;
    expect(textRules("West Ham are at home on Saturday: free chips after the match.", profile, "the email", 2)).toEqual([]);
    expect(textRules("Fans from East Ham welcome.", profile, "the email", 2)).toEqual([]);
    expect(textRules("Try our ham and cheese toastie.", profile, "the email", 2)).toEqual([expect.stringMatching(/dietary rules \("ham"\)/)]);
  });
});

describe("Insights may repeat the numbers in why a figure isn't available", () => {
  test("a held-back forecast's error and limit", async () => {
    const { numbersIn } = await import("@/lib/agents/insights-metrics");
    const r = { id: "m1", available: false as const, metric: "sales_forecast" as const, missing: "a forecast accurate enough to show", how_to_get: "Tested on this restaurant's past weeks, the forecast was off by 31% on average, over the 20% limit." };
    expect(numbersIn(r).map((f) => f.display)).toEqual(["31%", "20%"]);
  });
});
