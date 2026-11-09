// Advice (Insights job 7): 3 ideas from the restaurant's own figures, each with the
// message that starts it. The plain-code rules, and the route through the real code
// with a stand-in Claude (ideas with one-tap buttons; a tap starts that idea).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { numbersIn, queryMetrics, type MetricQueryInput, type MetricResult } from "@/lib/agents/insights-metrics";
import { insightsProblems, type InsightsOutput } from "@/lib/agents/insights-rules";
import { memoryDb } from "../support/memory-db";
import { caseData, loadInsightsCases } from "./support/insights-cases";

const q = (o: Partial<MetricQueryInput> & Pick<MetricQueryInput, "metric" | "period">): MetricQueryInput => ({ date: null, from: null, to: null, weekday: null, compare: "none", campaign: null, ...o });
const ember = caseData(loadInsightsCases().find((c) => c.file.startsWith("01"))!.case);
const weekday = queryMetrics(ember, q({ metric: "sales_by_weekday", period: "last_4_weeks" }), "q1") as MetricResult;
const money = numbersIn(weekday).find((n) => n.unit === "GBP")!;
const results = new Map([["q1", weekday]]);
const extras = [
  { ref: "menu:profit", numbers: [72, 31] },
  { ref: "facts:uk", numbers: [12.71, 10.85, 8] },
];

const idea = (title: string, why: string, message = "Draft a Thursday offer for the email list") => ({ title, why, message });
const advice = (o: Partial<InsightsOutput> = {}, content: Partial<InsightsOutput["content"]> = {}): InsightsOutput => ({
  type: "advice",
  channel: "owner",
  content: {
    headline: "Three ways to lift your margins this month:",
    body: "",
    actions: [
      idea("Fill your quietest night", `Your quietest day averaged ${money.display ?? `£${money.value}`} over the last 4 weeks.`),
      idea("Push the lamb chops", "Lamb chops keep 72% profit, your best dish.", "Post the lamb chops on Google"),
      idea("Cut waste on slow sellers", "General: prep slow sellers to order on quiet nights.", "Suggest next week's rota"),
    ],
    ...content,
  },
  figures: [
    { metric: "quietest_day_sales", value: money.value, unit: "GBP", period: "last 4 weeks", compare_to: null, compare_value: null, source: "metrics:q1" },
    { metric: "lamb_chops_margin", value: 72, unit: "percent", period: "menu", compare_to: null, compare_value: null, source: "menu:profit" },
  ],
  confidence: "high",
  needs_owner_input: null,
  sources_used: ["metrics:q1", "menu:profit"],
  ...o,
});
const problems = (out: InsightsOutput) => insightsProblems(out, { task: "advice", results, themes: null, extras });

describe("advice: the rules", () => {
  test("3 ideas, each tied to the restaurant's figures or labelled General, passes", () => {
    expect(problems(advice())).toEqual([]);
  });

  test("exactly 3 ideas, each with a why tied to a figure (or General:) and a message that starts it", () => {
    expect(problems(advice({}, { actions: advice().content.actions.slice(0, 2) })).join()).toMatch(/exactly 3 ideas/);
    const vague = advice({}, { actions: [idea("Run more offers", "Offers bring people in."), ...advice().content.actions.slice(1)] });
    expect(problems(vague).join()).toMatch(/idea 1's why must be tied/);
    const noStart = advice({}, { actions: [idea("Fill your quietest night", advice().content.actions[0].why, ""), ...advice().content.actions.slice(1)] });
    expect(problems(noStart).join()).toMatch(/needs the message that starts it/);
  });

  test("a figure from profit by dish or the UK facts must really be in it", () => {
    const wrong = advice({ figures: [advice().figures[0], { ...advice().figures[1], value: 80 }] }, { actions: [advice().content.actions[0], idea("Push the lamb chops", "Lamb chops keep 80% profit."), advice().content.actions[2]] });
    expect(problems(wrong).join()).toMatch(/lamb_chops_margin = 80 isn't in menu:profit/);
  });

  test("rotas and staffing levels are in scope for advice", () => {
    const rota = advice({}, { actions: [...advice().content.actions.slice(0, 2), idea("One fewer shift on Mondays", "General: you could consider cutting one shift on Mondays when it's quiet.", "Suggest next week's rota")] });
    expect(problems(rota)).toEqual([]);
  });

  test("tax, loans and decisions about a specific person's job are not", () => {
    for (const why of ["General: you could take out a loan to refit the kitchen.", "General: consider making Ali redundant.", "General: file your VAT return early."]) {
      const out = advice({}, { actions: [...advice().content.actions.slice(0, 2), idea("Something", why)] });
      expect(problems(out).join(), why).toMatch(/accountant, Acas or an adviser/);
    }
  });

  test("the answer and report rules are unchanged (no staffing advice there)", () => {
    const answer: InsightsOutput = { ...advice(), type: "answer", content: { headline: "", body: "You should consider cutting a shift on Mondays.", actions: [] }, figures: [], sources_used: [] };
    expect(insightsProblems(answer, { task: "answer", results }).join()).toMatch(/staffing, pay, loans or tax/);
  });
});

// ---------- The advice route, through the real code ----------

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const SANDBOX = "whatsapp:+14155238886";
const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "Three ways to improve my profit margins", language: "English", question: null, options: [], pasted_review: null, open_item: null, decision: null, sales: null, ...extra });
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let prompts: string[];
let sent: { text: string; buttons: unknown }[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  prompts = [];
  sent = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, slug: "mn-test", name: "MN Test", is_demo: true, active: true, agent_modes: { gm: "live", insights: "live" }, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, owner_name: "Miraan", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: {}, special_hours: {}, signup_reward: "A free baklava", profile_version: 1, send_window_start: "09:00:00", send_window_end: "21:00:00",
        menu: [{ category: "Grills", items: [{ name: "Lamb Chops", price: 14, cost: 4, description: null }] }], discount_cap_percent: 15, trust_levels: {}, sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null, paused: false, fake_now: null,
      },
    ],
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 10).padStart(2, "0")}`, source: "seed", is_dummy: true, net: 1200, gross: 1440 })),
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], reviews: [], draft_feedback: [], review_themes: [],
    z_reports: [], pos_imports: [], sales_items: [], sales_hours: [], customers: [], staff_numbers: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
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
          parse: async (args: { messages: { content: unknown }[] }) => {
            const c0 = args.messages[0]?.content;
            prompts.push(typeof c0 === "string" ? c0 : Array.isArray(c0) ? c0.map((c: { text?: string }) => c.text ?? "").join("\n") : "");
            const next = answers.shift();
            if (next === undefined) throw new Error("No more stand-in answers");
            return { stop_reason: "end_turn", content: [], parsed_output: next, usage: { input_tokens: 500, output_tokens: 50 }, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), chat: async () => ({ type: "text", text: "Today's answer" }) }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/assistant"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function say(body: string, buttonPayload?: string) {
  db.tables.messages.push({ id: `m${db.tables.messages.length}`, restaurant_id: A, direction: "inbound", body, status: "received", from_number: OWNER, to_number: SANDBOX, created_at: new Date().toISOString() });
  const { handleConversation } = await import("@/lib/bot/conversation");
  const restaurant = { ...db.tables.restaurants[0] };
  const ctx = { restaurantId: A, restaurant, restaurantName: restaurant.name, now: new Date(), today: "Monday 9 November 2026", reviews: [], customers: [] };
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });
  await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: SANDBOX, to: OWNER }, send } as never, body, buttonPayload);
}

const generalIdeas: InsightsOutput = {
  type: "advice",
  channel: "owner",
  content: {
    headline: "Three things to try this month:",
    body: "Add your dish costs and I can rank your margins.",
    actions: [
      idea("Fill your quietest night", "General: a midweek offer to your email list brings regulars back.", "Draft a Thursday offer for the email list"),
      idea("Post your best dish", "General: a weekly Google post keeps you visible.", "Post our best dish on Google"),
      idea("Check your rota", "General: match staff to your busy hours.", "Suggest next week's rota"),
    ],
  },
  figures: [],
  confidence: "low",
  needs_owner_input: null,
  sources_used: ["profile:menu"],
};

describe("what are three ways to improve my margins?", () => {
  test("3 ideas with a button each; the advice saw profit by dish and the UK facts", async () => {
    answers = [route("advice"), generalIdeas, passOn(["F1", "F2", "F3", "F4", "F5", "C6"])];
    await say("what are three things i can do to improve my profit margins");
    expect(prompts[1]).toContain("source menu:profit");
    expect(prompts[1]).toContain("Lamb Chops");
    expect(prompts[1]).toContain("National Living Wage");
    const card = db.tables.drafts.find((d) => d.kind === "choice")!;
    expect(card.agent_input.options.map((o: { label: string }) => o.label)).toEqual(["Start idea 1", "Start idea 2", "3. Check your rota"]);
    expect(sent[0].text).toMatch(/^💡 Three things to try this month:\n\n1\. \*Fill your quietest night\*: General:/);
    expect(sent[0].text).toContain("Add your dish costs and I can rank your margins.");
  });

  test("a tap starts that idea, understood like a typed request", async () => {
    answers = [route("advice"), generalIdeas, passOn(["F1", "F2", "F3", "F4", "F5", "C6"])];
    await say("how can we grow revenue next year");
    const card = db.tables.drafts.find((d) => d.kind === "choice")!;
    // The tap: the router reads "Suggest next week's rota" (the third idea's request).
    answers = [route("chat", { request: "Suggest next week's rota" })];
    await say("3. Check your rota", `choose:${card.id}:3`);
    expect(prompts.at(-1)).toContain(`"""Suggest next week's rota"""`);
    expect(db.tables.drafts.find((d) => d.id === card.id)).toMatchObject({ status: "answered" });
  });
});
