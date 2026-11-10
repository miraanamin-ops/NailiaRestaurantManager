// The GM understands what the owner means (9 Nov 2026 fix), with a stand-in Claude:
// it reads the conversation and everything waiting for an answer; an answer to a
// sales question in any words ("Before CAT", "sorry I meant before VAT"), a day's
// sales told in words, and a new topic while a question waits ("Thursday looks
// quiet" after a question about Sunday) all go where the owner meant. Replays the
// WhatsApp test that went wrong, step by step. The real-Claude version of the same
// messages is in agents/tests/gm/conversations.json (npm run test:agents -- gm).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AGENT_QUESTION_OPEN_MINUTES, recentDays, routerProblems, stillOpen, type RouterOutputType } from "@/lib/agents/gm-rules";
import { applySalesChange, typedConfirmQuestion, typedRead } from "@/lib/sales/typed";
import { memoryDb } from "../support/memory-db";
import { conversationKey, conversationProblems, loadConversations } from "./support/gm-cases";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const SANDBOX = "whatsapp:+14155238886";
// Monday 9 November 2026, 11:15 in London (GMT).
const NOW = new Date("2026-11-09T11:15:00Z");

const out = (route: RouterOutputType["route"], extra: Partial<RouterOutputType> = {}): RouterOutputType => ({
  route,
  request: "Owner's ask",
  language: "English",
  question: null,
  options: [],
  pasted_review: null,
  open_item: null,
  decision: null,
  sales: null,
  ...extra,
});
const figures = (f: Partial<NonNullable<RouterOutputType["sales"]>>) => ({ business_date: null, amount: null, basis: null, transactions: null, ...f });

describe("the router's rules", () => {
  test("answer_open must name a question that's actually waiting", () => {
    expect(routerProblems(out("answer_open", { open_item: "sales", decision: "yes" }), { openRefs: ["sales"] })).toEqual([]);
    expect(routerProblems(out("answer_open"), { openRefs: ["sales"] }).join()).toMatch(/name the open_item/);
    expect(routerProblems(out("answer_open", { open_item: "question" }), { openRefs: ["sales"] }).join()).toMatch(/isn't waiting/);
    // "Which did you mean?" is answered by routing the clarified message, not as an answer.
    expect(routerProblems(out("answer_open", { open_item: "choice" }), { openRefs: ["choice"] }).join()).toMatch(/clarified message/);
    // A figure for a specialist's question is still a figure: only code can save it.
    expect(routerProblems(out("answer_open", { open_item: "question", sales: figures({ amount: 1500 }) }), { openRefs: ["question"] }).join()).toMatch(/is sales_entry/);
    // Only answer_open carries a ref or a yes/no.
    expect(routerProblems(out("growth", { open_item: "sales" })).join()).toMatch(/only answer_open/);
    expect(routerProblems(out("growth", { decision: "yes" })).join()).toMatch(/only answer_open/);
  });

  test("a day's sales needs an amount in range, for a day that's happened", () => {
    expect(routerProblems(out("sales_entry", { sales: figures({ amount: 1500, basis: "net", business_date: "2026-11-08" }) }), { today: "2026-11-09" })).toEqual([]);
    expect(routerProblems(out("sales_entry", { sales: figures({}) })).join()).toMatch(/give the amount/);
    expect(routerProblems(out("sales_entry", { sales: figures({ amount: 0 }) })).join()).toMatch(/between £1/);
    expect(routerProblems(out("sales_entry", { sales: figures({ amount: 900, business_date: "2026-11-12" }) }), { today: "2026-11-09" }).join()).toMatch(/future/);
    expect(routerProblems(out("sales_entry", { sales: figures({ amount: 900, business_date: "8 Nov" }) })).join()).toMatch(/YYYY-MM-DD/);
    // Figures only travel with a sales route.
    expect(routerProblems(out("insights", { sales: figures({ amount: 900 }) })).join()).toMatch(/only sales_entry or answer_open/);
  });

  test("an option on a 'which did you mean?' can't be answer_open", () => {
    const ask = out("ambiguous", { request: "", question: "Which?", options: [{ label: "Offer", route: "growth" }, { label: "Answer", route: "answer_open" }] });
    expect(routerProblems(ask).join()).toMatch(/can't be answer_open/);
  });

  test("a specialist's question stops waiting after 30 minutes; a sales question after 6 hours", () => {
    const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    expect(stillOpen("agent_question", ago(5), NOW)).toBe(true);
    expect(stillOpen("agent_question", ago(AGENT_QUESTION_OPEN_MINUTES + 1), NOW)).toBe(false);
    // The trap from the test: a question asked at 11:16 caught "Thursday looks quiet" at 14:32.
    expect(stillOpen("agent_question", ago(196), NOW)).toBe(false);
    expect(stillOpen("choice", ago(31), NOW)).toBe(false);
    expect(stillOpen("sales_confirm", ago(5 * 60), NOW)).toBe(true);
    expect(stillOpen("sales_confirm", ago(7 * 60), NOW)).toBe(false);
  });

  test("the router gets real dates for 'yesterday' and weekdays", () => {
    const days = recentDays("2026-11-09");
    expect(days).toContain("Monday 9 Nov = 2026-11-09 (today)");
    expect(days).toContain("Sunday 8 Nov = 2026-11-08 (yesterday)");
    expect(days).toContain("Thursday 5 Nov = 2026-11-05");
  });
});

describe("changing a sales figure that's waiting for a yes", () => {
  const gross1500 = typedRead({ business_date: "2026-11-08", amount: 1500, basis: "gross", transactions: null });
  const none = { business_date: null, amount: null, basis: null, transactions: null };

  test('"before VAT" moves the one figure to net', () => {
    const read = applySalesChange(gross1500, { ...none, basis: "net" });
    expect(read).toMatchObject({ gross_sales: null, net_sales: 1500, business_date: "2026-11-08" });
  });

  test("a new amount, a new day, or the number of orders", () => {
    expect(applySalesChange(gross1500, { ...none, amount: 1650 })).toMatchObject({ gross_sales: 1650, net_sales: null });
    expect(applySalesChange(gross1500, { ...none, amount: 1650, basis: "net" })).toMatchObject({ gross_sales: null, net_sales: 1650 });
    expect(applySalesChange(gross1500, { ...none, business_date: "2026-11-07" })).toMatchObject({ gross_sales: 1500, business_date: "2026-11-07" });
    expect(applySalesChange(gross1500, { ...none, transactions: 92 })).toMatchObject({ gross_sales: 1500, transactions: 92 });
  });

  test("a till photo with both totals: a basis alone changes nothing (the report says which is which)", () => {
    const photo = { ...gross1500, gross_sales: 1800, net_sales: 1500, vat: 300 };
    expect(applySalesChange(photo, { ...none, basis: "net" })).toMatchObject({ gross_sales: 1800, net_sales: 1500, vat: 300 });
  });

  test("the confirm card never asks for special words", () => {
    const f = { business_date: "2026-11-08", gross_sales: 1500, net_sales: 1250, vat: null, transactions: null, card: null, cash: null, other_payments: null, discounts: null, refunds: null, hourly: [], net_estimated: true };
    const card = typedConfirmQuestion(f, [], "2026-11-09", "items");
    expect(card).not.toMatch(/reply \*NO\* and type|type it with|Reply with the day/i);
    expect(card).toMatch(/just say so/);
  });
});

// ---------- The conversation, through the real code ----------

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let prompts: string[];
let sent: string[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  prompts = [];
  sent = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: { gm: "live", insights: "live" }, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, owner_name: "Bilal", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: { Sunday: "12:00 – 22:00", Thursday: "12:00 – 22:00" }, special_hours: {}, signup_reward: "A free Mango Lassi", profile_version: 1,
        menu: [{ category: "Grills", items: [{ name: "Lamb Chops (4 pcs)", price: 13.95, description: null }] }], discount_cap_percent: 20, trust_levels: {},
        sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null, paused: false, fake_now: null,
      },
    ],
    // 14 days of dummy sales, so Insights (and so the GM) can be live in test mode.
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 10).padStart(2, "0")}`, source: "seed", is_dummy: true })),
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], reviews: [], draft_feedback: [],
    z_reports: [], pos_imports: [], sales_items: [], sales_hours: [],
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

// A line of the chat already on WhatsApp (oldest first), as the messages table logs it.
let clock = 0;
function logged(direction: "inbound" | "outbound", body: string) {
  clock++;
  db.tables.messages.push({
    id: `m${clock}`, restaurant_id: A, direction, body, status: direction === "inbound" ? "received" : "sent",
    from_number: direction === "inbound" ? OWNER : SANDBOX, to_number: direction === "inbound" ? SANDBOX : OWNER,
    created_at: new Date(NOW.getTime() - 3600_000 + clock * 1000).toISOString(),
  });
}

async function say(body: string) {
  logged("inbound", body);
  const { handleConversation } = await import("@/lib/bot/conversation");
  const restaurant = { ...db.tables.restaurants[0] };
  const ctx = { restaurantId: A, restaurant, restaurantName: restaurant.name, now: new Date(), today: "Monday 9 November 2026" };
  const send = async (text: string) => {
    sent.push(text);
    logged("outbound", text);
  };
  await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: SANDBOX, to: OWNER }, send } as never, body, undefined);
}

// The £1,500 the owner typed, shown back for a yes (as typedSales leaves it).
function pendingSales(fields: Record<string, unknown> = {}) {
  const read = typedRead({ business_date: "2026-11-08", amount: 1500, basis: "gross", transactions: null });
  db.tables.z_reports.push({
    id: "z1", restaurant_id: A, business_date: "2026-11-08", gross_sales: 1500, net_sales: 1250, vat: null, transactions: null, card: null, cash: null, other_payments: null, discounts: null, refunds: null, hourly: [],
    status: "needs_confirm", read, problems: [], photo_path: null, media_type: null, sent_by: OWNER, sender_role: "owner", is_dummy: false, saved_at: null,
    created_at: new Date(NOW.getTime() - 15_000).toISOString(),
    ...fields,
  });
}

function agentQuestion(minutesAgo: number, agent = "insights", content = "No sales data is recorded for yesterday (Sunday 8 November). Please send a photo of the Z-report.") {
  db.tables.drafts.push({
    id: "dddddddd-0000-0000-0000-000000000001", restaurant_id: A, kind: "agent_question", content, audience: "you", request: `A question from ${agent}`, status: "pending", waiting_for: "decision",
    agent_input: { agent, job: { question: "sorry i meant before VAT" } }, held_at: null, briefed_at: null, checks: {},
    created_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  });
}

describe("the WhatsApp test that went wrong, replayed", () => {
  test('"Before CAT" after a sales figure: read as before VAT, and shown back as net', async () => {
    logged("inbound", "Yesterdays sales 1500£");
    logged("outbound", "🧾 *Sun 8 Nov*: £1,500.00 including VAT (about £1,250.00 before VAT). Save it?");
    pendingSales();
    answers = [out("answer_open", { open_item: "sales", request: "Sunday 8 November's £1,500 was before VAT", sales: figures({ basis: "net" }) })];
    await say("Before CAT");
    // The router saw the conversation and the waiting sales question.
    expect(prompts[0]).toContain("Owner: Yesterdays sales 1500£");
    expect(prompts[0]).toMatch(/ref "sales".*Sun 8 Nov: £1,500\.00 including VAT/);
    expect(db.tables.z_reports[0]).toMatchObject({ status: "needs_confirm", gross_sales: null, net_sales: 1500 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^🧾 \*Sun 8 Nov\*: £1,500\.00 before VAT\. Save it\?/);
    // No "which did you mean?" card about a carrot cake review.
    expect(db.tables.drafts.filter((d) => d.kind === "choice")).toEqual([]);
  });

  test('"sorry I meant before VAT", then "yes": saved as £1,500 before VAT', async () => {
    pendingSales();
    answers = [out("answer_open", { open_item: "sales", request: "Sunday's £1,500 was before VAT", sales: figures({ basis: "net" }) })];
    await say("sorry i meant before VAT");
    answers = [out("answer_open", { open_item: "sales", decision: "yes", request: "Save Sunday 8 November's sales as £1,500 before VAT" })];
    await say("yes thats right");
    expect(db.tables.z_reports[0]).toMatchObject({ status: "saved", net_sales: 1500, gross_sales: null });
    expect(sent.at(-1)).toBe("Sun 8 Nov: £1,500.00 before VAT. Saved. 👍");
  });

  test('"it was 1500£ before VAT" with nothing waiting: a day\'s sales, shown back for a yes (not a request for a Z-report photo)', async () => {
    answers = [out("sales_entry", { request: "Save Sunday 8 November's sales as £1,500 before VAT", sales: figures({ amount: 1500, basis: "net", business_date: "2026-11-08" }) })];
    await say("it was 1500£ before VAT");
    expect(db.tables.z_reports).toHaveLength(1);
    expect(db.tables.z_reports[0]).toMatchObject({ status: "needs_confirm", business_date: "2026-11-08", net_sales: 1500, gross_sales: null });
    expect(sent[0]).toMatch(/£1,500\.00 before VAT\. Save it\?/);
    expect(sent.join("\n")).not.toMatch(/Z-report|POS CSV/);
  });

  test('"Thursday looks quiet" hours after a question about Sunday: a new request, and the old question stops waiting', async () => {
    agentQuestion(196);
    answers = [out("growth", { request: "Draft an offer to fill Thursday 12 November" })];
    await say("Thursday looks quiet");
    // The 3-hour-old question wasn't offered to the router as something to answer...
    expect(prompts[0]).not.toContain('ref "question"');
    expect(prompts[0]).toContain("Nothing is waiting for an answer");
    // ...and it no longer waits, so it can't catch the next message either.
    expect(db.tables.drafts[0]).toMatchObject({ status: "superseded", waiting_for: null });
    // Growth isn't live in this test, so today's assistant answered: not Insights about Sunday.
    expect(sent).toEqual(["Today's answer"]);
  });

  test("a new topic while a fresh question waits: routed by what it asks, the question closed", async () => {
    agentQuestion(5);
    answers = [out("growth", { request: "Draft a deal for Thursday 12 November" })];
    await say("No I want a deal for thursday.");
    expect(prompts[0]).toContain('ref "question"');
    expect(db.tables.drafts[0]).toMatchObject({ status: "superseded", waiting_for: null });
    expect(sent).toEqual(["Today's answer"]);
  });

  test("a real answer to a fresh question goes back to that question", async () => {
    agentQuestion(5, "growth", "Which day would you like the offer for?");
    answers = [out("answer_open", { open_item: "question", request: "The offer is for Thursday 12 November" })];
    await say("thursday");
    expect(db.tables.drafts[0]).toMatchObject({ status: "answered", waiting_for: null });
    expect(db.tables.audit_log.some((l) => l.action === "answered" && /thursday/i.test(String(l.detail)))).toBe(true);
    expect(sent).toEqual(["👍 Thanks, noted."]);
  });
});

describe("after tapping Edit", () => {
  test("a message about something else isn't taken as the change: the draft waits for a decision again", async () => {
    db.tables.drafts.push({
      id: "eeeeeeee-0000-0000-0000-000000000001", restaurant_id: A, kind: "google_post", content: "Lamb chops are back this weekend.", audience: "Google", request: "post", status: "pending", waiting_for: "edit_instructions",
      held_at: null, briefed_at: null, checks: {}, created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    answers = [out("chat", { request: "Thanks" })];
    await say("thanks mate");
    expect(prompts[0]).toContain("the owner tapped Edit and was asked what to change");
    expect(db.tables.drafts[0]).toMatchObject({ content: "Lamb chops are back this weekend.", waiting_for: "decision" });
    expect(sent).toEqual(["Today's answer"]);
  });

  test("if the GM can't read it in time, the message is the change (as before)", async () => {
    db.tables.drafts.push({
      id: "eeeeeeee-0000-0000-0000-000000000002", restaurant_id: A, kind: "profile_change", content: "Change your details?", audience: "your details", request: "we close at 11 on fridays", status: "pending", waiting_for: "edit_instructions",
      held_at: null, briefed_at: null, checks: {}, agent_input: { changes: [] }, created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    // The router answers badly twice (so the GM gives up), then the correction is read.
    answers = [out("answer_open"), out("answer_open"), { changes: [] }];
    await say("make it 10pm");
    // correctFact read it as the correction to the card (as before the GM).
    expect(db.tables.drafts[0]).toMatchObject({ status: "superseded" });
    expect(sent.at(-1)).toMatch(/couldn't read that change/);
  });
});

// ---------- The real-Claude cases (agents/tests/gm/conversations.json) ----------

describe("conversation cases (run with real Claude by npm run test:agents -- gm)", () => {
  const file = loadConversations();

  test("cover the 9 Nov test and the ways it can go", () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(file.cases.map(conversationKey)).size).toBe(file.cases.length);
    for (const m of ["Before CAT", "sorry i meant before VAT", "it was 1500£ before VAT", "Thursday looks quiet", "No I want a deal for thursday."]) expect(file.cases.some((c) => c.message === m)).toBe(true);
    for (const route of ["answer_open", "sales_entry", "growth", "insights", "edit", "reputation", "profile_fact"] as const) expect(file.cases.some((c) => c.routes.includes(route))).toBe(true);
    // Every answer_open case has something waiting to answer, and its expected ref is one of them.
    for (const c of file.cases.filter((x) => x.routes.length === 1 && x.routes[0] === "answer_open")) {
      expect(c.open?.length, c.message).toBeTruthy();
      if (c.expect?.open_item) expect(c.open!.map((o) => o.ref)).toContain(c.expect.open_item);
    }
  });

  test("the judge catches the 9 Nov mistakes", () => {
    const beforeCat = file.cases.find((c) => c.message === "Before CAT")!;
    const carrotCake = out("ambiguous", { request: "", question: "Do you mean the carrot cake review?", options: [{ label: "Carrot cake review", route: "reputation" }, { label: "Menu change", route: "profile_fact" }] });
    expect(conversationProblems(beforeCat, carrotCake, file.today).join()).toMatch(/ambiguous, expected answer_open/);
    const right = out("answer_open", { open_item: "sales", request: "It was before VAT", sales: figures({ basis: "net" }) });
    expect(conversationProblems(beforeCat, right, file.today)).toEqual([]);
    const thursday = file.cases.find((c) => c.message === "Thursday looks quiet" && c.open?.some((o) => o.ref === "question"))!;
    expect(conversationProblems(thursday, out("answer_open", { open_item: "question" }), file.today).join()).toMatch(/expected growth/);
  });

  test("every recorded answer is right", () => {
    if (!file.recorded) return;
    const wrong = file.cases.filter((c) => {
      const r = file.recorded!.results.find((x) => x.key === conversationKey(c));
      return r && conversationProblems(c, r.output, file.today).length;
    });
    expect(wrong.map((c) => `${c.message} (${c.note})`)).toEqual([]);
  });
});
