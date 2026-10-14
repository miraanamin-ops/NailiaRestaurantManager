// The GM live (test mode), on WhatsApp, with a stand-in Claude: simple questions
// answered from the profile (checked), facts as confirm cards saved on Approve,
// "which did you mean?" with buttons, today's assistant when nothing live can
// answer, one-tap skip reasons, and the "on it" line.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });
const ownerPass = passOn(["F1", "F2", "F3", "F4", "F5", "C6"]);
const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "Owner's ask", language: "English", question: null, options: [], ...extra });

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let sent: { text: string; buttons: unknown }[];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  sent = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: { gm: "live", insights: "live" }, owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", owner_name: "Bilal", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: { Friday: "14:00 – 00:00", Sunday: "12:00 – 22:00" }, special_hours: {}, signup_reward: "A free Mango Lassi", profile_version: 1,
        menu: [{ category: "Grills", items: [{ name: "Lamb Chops (4 pcs)", price: 13.95, description: null }] }], discount_cap_percent: 20, trust_levels: {},
        sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null, paused: false, fake_now: null,
      },
    ],
    // 14 days of dummy sales, so Insights (and so the GM) can be live in test mode.
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 1).padStart(2, "0")}`, source: "seed" })),
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], reviews: [], draft_feedback: [],
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
  vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), chat: async () => ({ type: "text", text: "Today's answer" }) }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/assistant"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function say(body: string, buttonPayload?: string) {
  const { handleConversation } = await import("@/lib/bot/conversation");
  const restaurant = { ...db.tables.restaurants[0] };
  const ctx = { restaurantId: A, restaurant, restaurantName: restaurant.name, now: new Date("2026-10-12T10:00:00Z"), today: "Monday 12 October 2026" };
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });
  await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: "whatsapp:+14155238886", to: OWNER }, send } as never, body, buttonPayload);
}

describe("live routing", () => {
  test("a simple profile question is answered from the profile, checked first", async () => {
    answers = [route("profile_question"), { type: "reply", message: "We close at midnight on Friday, Bilal." }, ownerPass];
    await say("what time do we close friday?");
    expect(sent.map((s) => s.text)).toEqual(["We close at midnight on Friday, Bilal."]);
    expect(db.tables.agent_jobs[0]).toMatchObject({ kind: "gm_live", verdict: "profile_question" });
  });

  test("a reply the checker doesn't pass isn't sent: today's assistant answers", async () => {
    answers = [route("profile_question"), { type: "reply", message: "We close at 11pm on Friday." }, { ...ownerPass, verdict: "fail", checks: ownerPass.checks.map((c) => (c.id === "F2" ? { id: "F2", result: "fail", reason: "the profile says midnight", fix: "say midnight" } : c)) }];
    await say("what time do we close friday?");
    expect(sent.map((s) => s.text)).toEqual(["Today's answer"]);
  });

  test("general chat (and a specialist in shadow) goes to today's assistant", async () => {
    answers = [route("chat")];
    await say("thanks!");
    expect(sent.map((s) => s.text)).toEqual(["Today's answer"]);
  });

  test("if the router fails, today's assistant answers", async () => {
    answers = [];
    await say("how was last week?");
    expect(sent.map((s) => s.text)).toEqual(["Today's answer"]);
  });
});

describe("a fact about the restaurant", () => {
  test("a confirm card first; Approve saves it (UNDO-able)", async () => {
    answers = [route("profile_fact"), { changes: [{ change: "hours", day: "Friday", open: null, close: "23:00", closed: null, name: null, price: null, category: null, value: null, percent: null }] }];
    await say("we close at 11 now on fridays");
    expect(db.tables.drafts[0]).toMatchObject({ kind: "profile_change", status: "pending", waiting_for: "decision" });
    expect(sent[0].text).toContain("Change your details?");
    expect(sent[0].buttons).toBe(true);
    // Not saved yet.
    expect(db.tables.restaurants[0].opening_hours.Friday).toBe("14:00 – 00:00");
    await say("Approve", "approve");
    expect(db.tables.restaurants[0].opening_hours.Friday).toMatch(/23:00/);
    expect(db.tables.drafts[0]).toMatchObject({ status: "approved" });
    expect(sent.at(-1)!.text).toMatch(/UNDO/);
  });
});

describe("an unclear message", () => {
  test("one question with 2 or 3 buttons; the answer carries on with the original message", async () => {
    answers = [route("ambiguous", { request: "", question: "What should I do for Saturday?", options: [{ label: "A special offer for the weekend", route: "growth" }, { label: "The figures", route: "insights" }] })];
    await say("sort out saturday");
    const card = db.tables.drafts[0];
    expect(card).toMatchObject({ kind: "choice", status: "pending" });
    expect(sent[0]).toMatchObject({ text: "What should I do for Saturday?", buttons: { draftId: card.id, buttons: "choice", options: ["A special offer for", "The figures"] } });
    // Growth isn't live here, so today's assistant answers the original message.
    await say("A special offer for", `choose:${card.id}:1`);
    expect(db.tables.drafts[0]).toMatchObject({ status: "answered" });
    expect(sent.at(-1)!.text).toBe("Today's answer");
  });
});

describe("skip", () => {
  test("optional one-tap reasons, never a follow-up question", async () => {
    db.tables.drafts.push({ id: "11111111-2222-3333-4444-555555555555", restaurant_id: A, kind: "google_post", content: "A post", audience: "Google listing", status: "pending", waiting_for: "decision", version: 1, created_at: "2026-10-12T09:00:00Z" });
    await say("Skip", "skip");
    expect(sent[0]).toMatchObject({ text: expect.stringMatching(/Skipped. If you like, tap why/), buttons: { draftId: "11111111-2222-3333-4444-555555555555", buttons: "reasons" } });
    expect(db.tables.drafts[0].waiting_for).toBeNull();
    // A tapped reason is saved; the next message is never taken as one.
    await say("Wrong tone", "reason:11111111-2222-3333-4444-555555555555:1");
    expect(sent.at(-1)!.text).toBe("Thanks, noted. 🙏");
    expect(db.tables.draft_feedback[0]).toMatchObject({ kind: "skip", note: "Wrong tone" });
  });
});

test("the 'on it' line: only when the work takes longer than about 8 seconds, and only once", async () => {
  vi.useFakeTimers();
  const { withOnIt } = await import("@/lib/agents/gm-live");
  const lines: string[] = [];
  const send = async (t: string) => void lines.push(t);
  const quick = withOnIt(Promise.resolve("done"), send as never, "English");
  await vi.advanceTimersByTimeAsync(9000);
  expect(await quick).toBe("done");
  expect(lines).toEqual([]);
  let finish: (v: string) => void = () => {};
  const slow = withOnIt(new Promise<string>((r) => (finish = r)), send as never, "Roman Urdu");
  await vi.advanceTimersByTimeAsync(8500);
  expect(lines).toEqual(["Kar raha hoon, ek minute mein bataata hoon."]);
  finish("done");
  expect(await slow).toBe("done");
  await vi.advanceTimersByTimeAsync(20000);
  expect(lines).toHaveLength(1);
});
