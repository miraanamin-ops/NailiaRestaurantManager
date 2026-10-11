// Reputation live (switched on for a restaurant), with a stand-in Claude: the
// go-live checklist, the checker as a blocking step, the "needs the owner"
// question card (Reply publicly / Handle privately / Both), and the gate never
// sending a question.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseQuestionAnswer } from "@/lib/bot/parse";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const SIGN_OFF = "The Ember & Spice Grill family";
const CONTACT = "hello@ember.test";
const READY = {
  sign_off_name: SIGN_OFF,
  complaint_contact: CONTACT,
  recovery_offers: ["A free dessert on your next visit"],
  halal_statement: "All our meat is halal.",
  allergen_statement: "Please tell our team about any allergy.",
};
const restaurantRow = (extra: Record<string, unknown> = {}) => ({
  id: A, name: "Ember & Spice Grill", brand_voice: "Warm", menu: [], opening_hours: {}, discount_cap_percent: 20, agent_modes: { reputation: "live" },
  emoji_allowed: { review_replies: 1 }, words_to_avoid: [], profile_version: 4, paused: false, send_window_start: "09:00:00", send_window_end: "21:00:00",
  owner_whatsapp: "whatsapp:+447700900111", last_brief_at: null, fake_now: null, ...READY, ...extra,
});
const review = (id: string, rating: number, text: string) => ({ id, restaurant_id: A, author_name: "Daniel K.", rating, text, review_date: "2026-10-12T10:00:00Z", handled_at: null, claimed_at: null, replied: false });

const CHECKS = ["T1", "T2", "T3", "T4", "T5", "F1", "F2", "F3", "F4", "F5", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
const pass = (minor: { check: string; find: string; replace: string }[] = []) => ({
  verdict: "pass", checks: CHECKS.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: minor, owner_question: null, notes: "",
});
const reply = (reviewId: string, rating: number, text: string, extra: Record<string, unknown> = {}) => ({
  type: "review_reply", channel: "google", review_id: reviewId, rating, content: { text }, alert: rating <= 3, needs_owner_input: null,
  sources_used: [`review:${reviewId}`, "profile:sign_off_name", "profile:complaint_contact"], ...extra,
});

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let calls: string[];
const sent: { text: string; buttons: unknown }[] = [];

beforeEach(() => {
  vi.resetModules();
  answers = [];
  calls = [];
  sent.length = 0;
  db = memoryDb({ restaurants: [restaurantRow()], reviews: [], drafts: [], draft_feedback: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], customers: [], sent_log: [], blocked_sends: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string, buttons: unknown) => void sent.push({ text, buttons }) }));
  vi.doMock("@/lib/assistant", async (orig) => ({
    ...(await orig<object>()),
    writeReviewReply: async () => {
      throw new Error("today's assistant must not write replies when Reputation is live");
    },
  }));
  vi.doMock("@/lib/google", () => ({
    google: () => ({
      mode: "dummy",
      claimNewReviews: async () => db.tables.reviews.filter((r) => !r.handled_at),
      markReviewHandled: async (id: string) => void Object.assign(db.tables.reviews.find((r) => r.id === id)!, { handled_at: "now" }),
      releaseReview: async () => {},
      listReviews: async () => db.tables.reviews,
      replyToReview: vi.fn(),
    }),
  }));
  vi.doMock("@/lib/claude", () => ({
    MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
    MODEL: "claude-sonnet-5-5",
    MAX_TOKENS: 100,
    WITH_FALLBACK: {},
    fallbackFor: () => ({}),
    claude: () => ({
      beta: {
        messages: {
          parse: async (req: { messages: { content: { text?: string }[] }[] }) => {
            calls.push(req.messages[0].content.map((c) => c.text ?? "").join("\n"));
            const next = answers.shift();
            if (next === undefined) throw new Error("No more stand-in answers");
            return { stop_reason: "end_turn", parsed_output: next };
          },
        },
      },
    }),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/notify", "@/lib/assistant", "@/lib/google", "@/lib/claude"]) vi.doUnmock(m);
});

async function turn() {
  const { loadRestaurantContext } = await import("@/lib/assistant");
  const ctx = await loadRestaurantContext(A, { realTime: true });
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });
  return { ctx, channel: { restaurantId: A, from: "x", to: "y" }, owner: "whatsapp:+447700900111", send };
}

describe("the go-live checklist", () => {
  test("Reputation set to live stays in shadow until its five profile fields are filled", async () => {
    const { reputationMode } = await import("@/lib/agents/reputation");
    expect(reputationMode(restaurantRow() as never)).toBe("live");
    expect(reputationMode(restaurantRow({ halal_statement: null }) as never)).toBe("shadow");
    expect(reputationMode(restaurantRow({ recovery_offers: [] }) as never)).toBe("shadow");
    expect(reputationMode(restaurantRow({ agent_modes: {} }) as never)).toBe("shadow");
  });
});

describe("live replies", () => {
  test("Reputation writes the owner's draft; the checker's minor fixes are applied; no shadow jobs", async () => {
    db.tables.reviews.push(review("rv1", 5, "Lovely lamb chops."));
    answers = [reply("rv1", 5, `Thanks Daniel! The lamb chops are our pride.\n\n${SIGN_OFF}`, { sources_used: ["review:rv1", "profile:sign_off_name"] }), pass([{ check: "T3", find: "Thanks Daniel!", replace: "Thanks, Daniel!" }])];
    const { runReviewCheck } = await import("@/lib/google-jobs");
    const t = await turn();
    expect(await runReviewCheck(t.ctx, t.send)).toMatchObject({ found: 1, held: 1, failed: 0 });
    const [d] = db.tables.drafts;
    expect(d).toMatchObject({ kind: "review_reply", status: "pending", review_id: "rv1" });
    expect(d.content).toContain("Thanks, Daniel!");
    expect(d.agent_check).toMatchObject({ mode: "live", verdict: "pass" });
    expect((d.checks as { tone: { fixes: string[] } }).tone.fixes[0]).toContain("Thanks, Daniel!");
    expect(db.tables.agent_jobs.map((j) => j.kind)).toEqual(["reputation_live"]); // recorded, no shadow jobs queued
    expect(db.tables.reviews[0].handled_at).toBeTruthy();
    expect(sent).toEqual([]); // 5 stars: held for the brief
  });

  test("a low-star review that needs the owner: an urgent question card with its three buttons", async () => {
    db.tables.reviews.push(review("rv2", 1, "I got food poisoning after the mixed grill."));
    answers = [reply("rv2", 1, "", { needs_owner_input: "This review mentions food poisoning. Do you want to reply publicly, contact them privately, or both?", sources_used: ["review:rv2"] })];
    const { runReviewCheck } = await import("@/lib/google-jobs");
    const t = await turn();
    expect(await runReviewCheck(t.ctx, t.send)).toMatchObject({ alerts: 1 });
    const [d] = db.tables.drafts;
    expect(d).toMatchObject({ kind: "review_question", status: "pending", waiting_for: "decision" });
    expect(d.content).toMatch(/food poisoning/);
    expect(sent[0].text).toMatch(/needs your decision before anything is drafted/);
    expect(sent[0].buttons).toEqual({ draftId: d.id, buttons: "question" });
    expect(calls).toHaveLength(1); // no checker call: there's no reply to check
  });

  test("the gate never sends a question, and APPROVE ALL leaves it alone", async () => {
    db.tables.reviews.push(review("rv2", 1, "Food poisoning."));
    answers = [reply("rv2", 1, "", { needs_owner_input: "Reply publicly, privately or both?", sources_used: ["review:rv2"] })];
    const { runReviewCheck } = await import("@/lib/google-jobs");
    const t = await turn();
    await runReviewCheck(t.ctx, t.send);
    const q = db.tables.drafts[0];
    Object.assign(q, { approved_at: "2026-10-12T10:00:00Z", status: "approved" });
    const { attemptSend } = await import("@/lib/send");
    expect(await attemptSend(String(q.id), db.tables.restaurants[0] as never, new Date("2026-10-12T11:00:00Z"), "approve")).toMatchObject({ outcome: "blocked", reason: "not_approved" });
    expect(db.tables.sent_log).toEqual([]);

    Object.assign(q, { approved_at: null, status: "pending", briefed_at: "B", brief_number: 1 });
    db.tables.restaurants[0].last_brief_at = "B";
    const { approveAll } = await import("@/lib/brief");
    expect(await approveAll(db.tables.restaurants[0] as never, new Date())).toMatch(/Only a question is left/);
    expect(q.status).toBe("pending");
  });
});

describe("answering a question", () => {
  async function questionFor(source = "review_check") {
    db.tables.reviews.push(review("rv3", 1, "Told them about my nut allergy and still had a reaction."));
    const { createDraft } = await import("@/lib/drafts");
    return createDraft({
      restaurantId: A, kind: "review_question", content: "This review mentions an allergic reaction. Reply publicly, privately or both?", audience: "Google review by Daniel K.",
      request: "Reputation needs your decision", reviewId: "rv3", checks: {}, mode: "present", actor: "reputation",
      agentInput: { review: { id: "rv3", author_name: "Daniel K.", rating: 1, text: "Told them about my nut allergy and still had a reaction." }, source },
    });
  }

  test("Handle privately: answered, logged, nothing drafted", async () => {
    const q = await questionFor();
    const { answerQuestion } = await import("@/lib/bot/questions");
    await answerQuestion((await turn()) as never, { choice: "private", draftId: q.id }, null);
    expect(db.tables.drafts).toHaveLength(1);
    expect(db.tables.drafts[0].status).toBe("answered");
    expect(db.tables.audit_log.find((e) => e.action === "answered")).toMatchObject({ actor: "owner", data: { choice: "private" } });
    expect(sent.at(-1)!.text).toMatch(/handle Daniel K\. privately. Nothing will be posted/);
    expect(calls).toEqual([]);
  });

  test("Both: Reputation writes the reply with the owner's choice, checked, with Approve / Edit / Skip", async () => {
    const q = await questionFor();
    answers = [reply("rv3", 1, `Thank you for telling us, Daniel, and we're so sorry. Our team will contact you directly. You can also email ${CONTACT}.\n\n${SIGN_OFF}`), pass()];
    const { answerQuestion } = await import("@/lib/bot/questions");
    await answerQuestion((await turn()) as never, { choice: "both", draftId: q.id }, null);
    expect(calls[0]).toMatch(/They chose: reply publicly AND contact the reviewer privately/);
    const r = db.tables.drafts.find((d) => d.kind === "review_reply")!;
    expect(r).toMatchObject({ status: "pending", review_id: "rv3", waiting_for: "decision" });
    expect(r.agent_check).toMatchObject({ mode: "live", verdict: "pass" });
    expect(sent.at(-1)).toMatchObject({ buttons: true });
    expect(sent.at(-1)!.text).toMatch(/Remember to contact Daniel K\. privately too/);
  });

  test("a question already answered isn't answered twice", async () => {
    const q = await questionFor();
    const { answerQuestion } = await import("@/lib/bot/questions");
    await answerQuestion((await turn()) as never, { choice: "private", draftId: q.id }, null);
    await answerQuestion((await turn()) as never, { choice: "both", draftId: q.id }, null);
    expect(sent.at(-1)!.text).toMatch(/already been answered/);
    expect(calls).toEqual([]);
  });
});

describe("reading the answer", () => {
  test("buttons, typed brief answers, and plain words only while a question is on screen", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(parseQuestionAnswer(`both:${id}`, "", false)).toEqual({ choice: "both", draftId: id });
    expect(parseQuestionAnswer(undefined, "PUBLIC 2", false)).toEqual({ choice: "public", briefNumber: 2 });
    expect(parseQuestionAnswer(undefined, "handle privately", true)).toEqual({ choice: "private" });
    expect(parseQuestionAnswer(undefined, "1", true)).toEqual({ choice: "public" });
    expect(parseQuestionAnswer(undefined, "1", false)).toBeNull(); // with no question on screen, 1 still means Approve
    expect(parseQuestionAnswer(`approve:${id}`, "", true)).toBeNull();
  });
});

describe("questions in the morning brief", () => {
  test("listed as 'your call', with the question as its message", async () => {
    const { composeBrief } = await import("@/lib/brief");
    const q = { id: "q1", kind: "review_question", content: "Reply publicly, privately or both?", audience: "Google review by Daniel K.", review_id: "rv9", version: 1, checks: {}, check_notes: null } as never;
    const out = composeBrief({ items: [q], totalWaiting: 1, reviews: new Map([["rv9", { id: "rv9", author_name: "Daniel K.", rating: 1, text: "Food poisoning." }]]), names: new Map(), tally: [], restaurant: { discount_cap_percent: 20 } });
    expect(out.summary).toContain("❓ Your call on Daniel K's 1⭐ review");
    expect(out.itemMessages[0]).toContain("Nothing is posted until you choose.");
  });
});
