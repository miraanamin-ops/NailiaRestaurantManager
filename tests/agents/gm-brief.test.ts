// The GM live (test mode), with a stand-in Claude: the morning brief (at most 5
// cards, ranked; the rest roll to tomorrow; buttons by kind; today's brief if the
// composer fails), alerts (one an hour, held in quiet hours, released by the hourly
// job, dropped if already dealt with) and questions from scheduled work.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const channel = { restaurantId: A, from: "whatsapp:+14155238886", to: OWNER };
const say = (type: string, message: string) => ({ type, message });

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
        id: A, name: "Ember & Spice Grill", is_demo: true, active: true, agent_modes: { gm: "live" }, owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", owner_name: "Bilal", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", discount_cap_percent: 20, menu: [], paused: false, fake_now: null,
      },
    ],
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], owner_alerts: [], reviews: [], messages: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string, buttons: unknown = false) => void sent.push({ text, buttons }) }));
  vi.doMock("@/lib/feedback", () => ({ feedbackForBrief: async () => ({ lines: [], ids: [] }), markFeedbackReported: async () => {} }));
  vi.doMock("@/lib/sales/z-reports", () => ({ zNudgeFor: async () => null }));
  vi.doMock("@/lib/brief", async (orig) => ({ ...(await orig<object>()), doneTally: async () => ["2 reviews answered"], sendBrief: async () => (sent.push({ text: "TODAY'S BRIEF", buttons: false }), { sent: true, items: 0, tally: [] }) }));
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
            return { stop_reason: "end_turn", content: [], parsed_output: next, usage: { input_tokens: 500, output_tokens: 50 }, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/notify", "@/lib/feedback", "@/lib/sales/z-reports", "@/lib/brief", "@/lib/claude"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;
function draft(id: string, kind: string, extra: Record<string, unknown> = {}) {
  const row = { id, restaurant_id: A, kind, content: `Draft ${id}`, audience: "Google listing", status: "pending", waiting_for: null, version: 1, checks: {}, request: null, created_at: `2026-10-1${id.slice(-1)}T08:00:00Z`, ...extra };
  db.tables.drafts.push(row);
  return row;
}
const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

describe("the live morning brief", () => {
  test("a summary, then at most 5 cards ranked (urgent first); the rest roll to tomorrow", async () => {
    for (let n = 1; n <= 6; n++) draft(uuid(n), "google_post");
    draft(uuid(7), "review_reply", { request: "Review check: low rating alert" });
    answers = [say("brief", "Morning Bilal. 2 reviews answered. 5 things need a yes today."), ...Array.from({ length: 5 }, () => say("card", "A Google post for this week."))];
    const { gmBrief } = await import("@/lib/agents/gm-brief");
    const out = await gmBrief(restaurant(), channel, new Date("2026-10-12T08:00:00Z"));
    expect(out).toMatchObject({ sent: true, items: 5 });
    expect(sent[0].text).toBe("Morning Bilal. 2 reviews answered. 5 things need a yes today.");
    expect(sent.slice(1).map((s) => s.text.split("\n")[0])).toEqual(["*1 of 5*", "*2 of 5*", "*3 of 5*", "*4 of 5*", "*5 of 5*"]);
    // The urgent one (a low rating) comes first, then the oldest.
    expect(sent[1].buttons).toMatchObject({ draftId: uuid(7), briefNumber: 1, buttons: "approval" });
    expect(sent[2].buttons).toMatchObject({ draftId: uuid(1), briefNumber: 2 });
    const briefed = db.tables.drafts.filter((d) => d.briefed_at).map((d) => d.id);
    expect(briefed).toHaveLength(5);
    expect(briefed).not.toContain(uuid(5));
    expect(briefed).not.toContain(uuid(6));
    expect(db.tables.agent_jobs.at(-1)).toMatchObject({ kind: "gm_live", verdict: "brief" });
  });

  test("buttons by kind: Like it / Skip for a special idea, none for an agent's question (answered in words)", async () => {
    draft(uuid(1), "special_idea", { audience: "you (an idea for the menu)" });
    draft(uuid(2), "agent_question", { audience: "you", content: "Did you have a power cut on Saturday?" });
    answers = [say("brief", "Morning Bilal. 2 things for you today."), say("card", "A special idea for this week."), say("card", "A question about Saturday.")];
    const { gmBrief } = await import("@/lib/agents/gm-brief");
    await gmBrief(restaurant(), channel, new Date("2026-10-12T08:00:00Z"));
    expect(sent[1].buttons).toMatchObject({ draftId: uuid(1), buttons: "idea" });
    expect(sent[2].buttons).toBe(false);
    expect(sent[2].text).toMatch(/Reply with your answer/);
  });

  test("if the composer fails, today's brief goes instead", async () => {
    draft(uuid(1), "google_post");
    answers = [];
    const { gmBrief } = await import("@/lib/agents/gm-brief");
    await gmBrief(restaurant(), channel, new Date("2026-10-12T08:00:00Z"));
    expect(sent.map((s) => s.text)).toEqual(["TODAY'S BRIEF"]);
  });

  test("nothing waiting and nothing done: no brief", async () => {
    vi.doMock("@/lib/brief", async (orig) => ({ ...(await orig<object>()), doneTally: async () => [] }));
    const { gmBrief } = await import("@/lib/agents/gm-brief");
    expect(await gmBrief(restaurant(), channel, new Date("2026-10-12T08:00:00Z"))).toMatchObject({ sent: false });
    expect(sent).toEqual([]);
  });
});

describe("alerts", () => {
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });

  test("one an hour: the second waits for the next hour, then the hourly job sends it", async () => {
    const first = draft(uuid(1), "review_reply", { waiting_for: "decision" });
    const second = draft(uuid(2), "review_reply", { waiting_for: "decision" });
    answers = [say("alert", "A 2-star review needs a reply.")];
    const { gmAlert, releaseAlerts } = await import("@/lib/agents/gm-brief");
    expect(await gmAlert(restaurant(), send, new Date("2026-10-12T10:00:00Z"), { draft: first as never, detail: "*2-star review just came in.*" })).toBe("sent");
    expect(sent[0].text).toMatch(/^🚨 A 2-star review needs a reply\.\n\n\*2-star review just came in\.\*/);
    expect(sent[0].buttons).toMatchObject({ draftId: uuid(1), buttons: "approval" });

    expect(await gmAlert(restaurant(), send, new Date("2026-10-12T10:20:00Z"), { draft: second as never, detail: "*1-star review just came in.*" })).toBe("held");
    expect(sent).toHaveLength(1);
    expect(db.tables.drafts[1].waiting_for).toBeNull();
    expect(db.tables.owner_alerts[1]).toMatchObject({ reason: "hourly_limit", due_at: "2026-10-12T11:00:00.000Z" });
    expect(db.tables.owner_alerts[1].sent_at ?? null).toBeNull();

    // Not due yet.
    expect(await releaseAlerts(restaurant(), send, new Date("2026-10-12T10:40:00Z"))).toBeNull();
    // Due: sent, back on screen with its buttons.
    answers = [say("alert", "A 1-star review needs a reply.")];
    expect(await releaseAlerts(restaurant(), send, new Date("2026-10-12T11:05:00Z"))).toBe(db.tables.owner_alerts[1].id);
    expect(sent[1].text).toMatch(/1-star review just came in/);
    expect(db.tables.drafts[1].waiting_for).toBe("decision");
  });

  test("held in quiet hours until they end (9am UK time)", async () => {
    const d = draft(uuid(1), "review_reply", { waiting_for: "decision" });
    const { gmAlert } = await import("@/lib/agents/gm-brief");
    expect(await gmAlert(restaurant(), send, new Date("2026-10-12T23:30:00Z"), { draft: d as never, detail: "x" })).toBe("held");
    expect(db.tables.owner_alerts[0]).toMatchObject({ reason: "quiet_hours", due_at: "2026-10-13T08:00:00.000Z" });
    expect(sent).toEqual([]);
  });

  test("a held alert already dealt with (e.g. in the brief) isn't sent and doesn't use up the hour", async () => {
    const d = draft(uuid(1), "review_reply", { waiting_for: "decision" });
    const { gmAlert, releaseAlerts } = await import("@/lib/agents/gm-brief");
    await gmAlert(restaurant(), send, new Date("2026-10-12T23:30:00Z"), { draft: d as never, detail: "x" });
    db.tables.drafts[0].status = "approved";
    expect(await releaseAlerts(restaurant(), send, new Date("2026-10-13T08:05:00Z"))).toBeNull();
    expect(sent).toEqual([]);
    expect(db.tables.owner_alerts).toEqual([]);
  });

  test("bad private feedback (no draft) keeps code's wording", async () => {
    const { gmAlert } = await import("@/lib/agents/gm-brief");
    await gmAlert(restaurant(), send, new Date("2026-10-12T10:00:00Z"), { detail: "🚨 *Private feedback: 2★ from Sam*" });
    expect(sent).toEqual([{ text: "🚨 *Private feedback: 2★ from Sam*", buttons: false }]);
  });
});

test("questions and special ideas from scheduled work are held for the brief, never messaged", async () => {
  const { holdAgentQuestion, holdSpecialIdea } = await import("@/lib/agents/gm-held");
  await holdAgentQuestion(restaurant(), "insights", "No till report for Saturday: were you closed?", { task: "report" });
  await holdSpecialIdea(restaurant(), "Lamb Chop Wrap\nWhy now: chops sell well on Fridays");
  expect(db.tables.drafts.map((d) => [d.kind, d.status, d.waiting_for ?? null])).toEqual([
    ["agent_question", "pending", null],
    ["special_idea", "pending", null],
  ]);
  expect(db.tables.drafts[0].agent_input).toMatchObject({ agent: "insights" });
  expect(sent).toEqual([]);
});
