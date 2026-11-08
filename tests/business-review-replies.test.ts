// The business review's reply backlog (step 4): the latest reviews are read, a
// reply drafted for each with none (in batches, never twice), Approve all only
// ever takes 4 to 5 star replies that passed every check, approved replies are
// released one job each a few seconds apart, and UNDO takes the batch back down.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { approveAllSet, passedEveryCheck } from "@/lib/review/rules";

const R = "abababab-0000-4000-8000-000000000058";
const RV = "abababab-0000-4000-8000-00000000a058";
const pass = { status: "pass", fixes: [], flags: [], at: "2026-11-03T10:00:00Z" };
const flagged = { status: "flagged", fixes: [], flags: ["The price isn't on the menu"], at: "2026-11-03T10:00:00Z" };
const allPass = { tone: pass, facts: pass, compliance: pass, money: pass };

describe("which replies Approve all takes", () => {
  const d = (rating: number | null, extra: Record<string, unknown> = {}) => ({ kind: "review_reply", status: "pending", rating, checks: allPass, agent_check: null, ...extra });
  test("4 to 5 stars that passed every check; never 1 to 3 stars, a flag, a failed checker or a question", () => {
    const set = [d(5), d(4), d(3), d(1), d(5, { checks: { ...allPass, facts: flagged } }), d(5, { agent_check: { verdict: "fail" } }), d(5, { kind: "review_question" }), d(4, { status: "approved" }), d(5, { checks: null })];
    expect(approveAllSet(set)).toEqual([set[0], set[1]]);
    expect(passedEveryCheck(d(5, { checks: { ...allPass, tone: { ...pass, status: "fixed" } } }))).toBe(true);
  });
});

let db: ReturnType<typeof memoryDb>;
let queued: { type: string; key: string; payload: Record<string, unknown>; runAt?: Date }[];
let drafted: string[];

// 25 reviews: 3 answered; of the 22 with no reply, 16 are 4 to 5 stars (one of
// whose replies a check flags) and 6 are 1 to 3 stars.
function reviews() {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < 25; i++) {
    const rating = i < 6 ? [1, 2, 3, 2, 3, 1][i] : i < 22 ? (i % 2 ? 5 : 4) : 5;
    out.push({
      id: `rev-${String(i).padStart(2, "0")}`,
      restaurant_id: R,
      author_name: `Guest ${i}`,
      rating,
      text: `Review ${i}`,
      review_date: new Date(Date.UTC(2026, 9, 30 - i)).toISOString(),
      replied: i >= 22,
      reply_text: i >= 22 ? "Thanks!" : null,
      handled_at: null,
      claimed_at: null,
      source: "dummy",
    });
  }
  return out;
}

beforeEach(() => {
  vi.resetModules();
  queued = [];
  drafted = [];
  db = memoryDb(
    {
      restaurants: [
        {
          id: R, name: "Ember & Spice", slug: "ember-spice", is_demo: true, owner_whatsapp: "whatsapp:+447700900158", whatsapp_from: "whatsapp:+14155238886",
          dummy_google_profile: { rating: 4.4, reviewCount: 132 }, paused: false, send_window_start: "00:00:00", send_window_end: "23:59:00", discount_cap_percent: 20, fake_now: null, agent_modes: null,
        },
      ],
      business_reviews: [{ id: RV, restaurant_id: R, status: "running", google_connected: true, flow_state: {}, created_at: "2026-11-03T10:00:00Z" }],
      business_review_parts: [],
      reviews: reviews(),
      drafts: [],
      audit_log: [],
      sent_log: [],
      blocked_sends: [],
      time_saved_log: [],
      google_writes: [],
      messages: [],
    },
    { unique: ["time_saved_log.ref"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/queue/store", () => ({
    enqueue: async (input: { type: string; key: string; payload?: Record<string, unknown>; runAt?: Date }) => {
      if (queued.some((q) => q.key === input.key)) return null;
      queued.push({ type: input.type, key: input.key, payload: input.payload ?? {}, runAt: input.runAt });
      return { id: input.key };
    },
  }));
  vi.doMock("@/lib/assistant", () => ({ loadRestaurantContext: async () => ({ restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }) }));
  // The reply writer and its four checks stand in here (their own tests cover them).
  vi.doMock("@/lib/google-jobs", () => ({
    draftReviewReply: async (_ctx: unknown, _l: unknown, review: { id: string; rating: number }, opts?: { request?: string }) => {
      drafted.push(review.id);
      const row = { id: `draft-${review.id}`, restaurant_id: R, kind: "review_reply", status: "pending", content: `Thank you, ${review.id}!`, review_id: review.id, version: 1, held_at: new Date().toISOString(), waiting_for: null, approved_at: null, sent_at: null, created_at: new Date().toISOString(), checks: review.id === "rev-07" ? { ...allPass, facts: flagged } : allPass, agent_check: null, audience: "Google review", request: opts?.request ?? null };
      db.tables.drafts.push(row);
      Object.assign(db.tables.reviews.find((x) => x.id === review.id)!, { handled_at: new Date().toISOString(), claimed_at: null });
      return row;
    },
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/queue/store", "@/lib/assistant", "@/lib/google-jobs"]) vi.doUnmock(m);
});

const ctx = (round = 0) => ({ review: db.tables.business_reviews[0] as never, restaurant: db.tables.restaurants[0] as never, now: new Date(), connected: true, round });

describe("the backlog", () => {
  test("sync: the rating from the profile, every review read taken over from the hourly check", async () => {
    const { syncPart } = await import("@/lib/review/parts/reviews");
    expect(await syncPart(ctx())).toEqual({ connected: true, rating: 4.4, total: 132, synced: 25, unanswered: 22 });
    expect(db.tables.reviews.every((r) => r.handled_at)).toBe(true);
  });

  test("replies in batches of 10, each review once, even when a round runs twice; at most 15 on day one, the worst-rated first (8 Nov 2026)", async () => {
    const { backlogPart } = await import("@/lib/review/parts/reviews");
    const { isContinue } = await import("@/lib/review/parts");
    const first = await backlogPart(ctx(0));
    expect(isContinue(first)).toBe(true);
    expect(drafted).toHaveLength(10);
    await backlogPart(ctx(1));
    await backlogPart(ctx(1)); // the same round again (a retried job)
    const last = await backlogPart(ctx(2));
    expect(isContinue(last)).toBe(false);
    expect(new Set(drafted).size).toBe(15);
    expect(drafted).toHaveLength(15);
    // The six 1 to 3 star reviews first, then the newest of the rest.
    expect(drafted.slice(0, 6).sort()).toEqual(["rev-00", "rev-01", "rev-02", "rev-03", "rev-04", "rev-05"]);
    expect(last).toEqual({ unanswered: 22, drafted: 15, positiveReady: 8, negative: 6 });
    expect(db.tables.drafts.every((d) => d.business_review_id === RV)).toBe(true);
    expect(db.tables.time_saved_log).toHaveLength(15);
  });

  test("Google not connected: nothing drafted", async () => {
    const { backlogPart } = await import("@/lib/review/parts/reviews");
    expect(await backlogPart({ ...ctx(), connected: false })).toEqual({ unanswered: 0, drafted: 0, positiveReady: 0, negative: 0 });
    expect(drafted).toEqual([]);
  });
});

describe("Approve all, the release and UNDO", () => {
  async function drafted22() {
    const { backlogPart } = await import("@/lib/review/parts/reviews");
    for (let round = 0; round < 4; round++) await backlogPart(ctx(round));
  }

  test("only 4 to 5 star replies that passed every check; each released once, 10 seconds apart; nothing posts without approval", async () => {
    await drafted22();
    const { approveAllPositive } = await import("@/lib/review/replies");
    const now = new Date("2026-11-03T12:00:00Z");
    const { approved } = await approveAllPositive(db.tables.restaurants[0] as never, RV, now);
    expect(approved).toBe(8);
    const approvedIds = db.tables.drafts.filter((d) => d.status === "approved").map((d) => d.review_id);
    expect(approvedIds).toHaveLength(8);
    for (const id of approvedIds) expect(db.tables.reviews.find((r) => r.id === id)!.rating).toBeGreaterThanOrEqual(4);
    expect(approvedIds).not.toContain("rev-07"); // its reply was flagged
    const releases = queued.filter((q) => q.type === "review_reply_release");
    expect(releases).toHaveLength(8);
    expect(releases[1].runAt!.getTime() - releases[0].runAt!.getTime()).toBe(10_000);
    // Nothing reached (dummy) Google yet: only the release does that.
    expect(db.tables.reviews.filter((r) => r.reply_text && r.reply_text !== "Thanks!")).toHaveLength(0);
    // Approve all again: nothing more.
    expect((await approveAllPositive(db.tables.restaurants[0] as never, RV, now)).approved).toBe(0);
  });

  test("released through the gate (once each, even run twice), then one UNDO takes every reply back down", async () => {
    await drafted22();
    const { approveAllPositive, releaseReplyHandler } = await import("@/lib/review/replies");
    await approveAllPositive(db.tables.restaurants[0] as never, RV, new Date());
    const releases = queued.filter((q) => q.type === "review_reply_release");
    for (const q of releases) await releaseReplyHandler.run({ payload: q.payload, restaurant_id: R } as never);
    const posted = () => db.tables.reviews.filter((r) => r.replied && r.reply_text !== "Thanks!");
    expect(posted()).toHaveLength(8);
    // A retried release job: the gate refuses a second post.
    const again = await releaseReplyHandler.run({ payload: releases[0].payload, restaurant_id: R } as never);
    expect(again).toMatchObject({ outcome: "blocked", reason: "duplicate" });
    expect(posted()).toHaveLength(8);
    const { undoLast } = await import("@/lib/undo");
    await undoLast(db.tables.restaurants[0] as never, new Date());
    expect(posted()).toHaveLength(0);
    expect(db.tables.drafts.filter((d) => d.status === "withdrawn")).toHaveLength(8);
  });
});

describe("the replies in the guided flow", () => {
  test("Approve all from the flow, then the harder ones one by one, each after the last decision", async () => {
    const { backlogPart } = await import("@/lib/review/parts/reviews");
    for (let round = 0; round < 4; round++) await backlogPart(ctx(round));
    db.tables.business_reviews[0].status = "sent";
    const out: { text: string; buttons: string[] }[] = [];
    vi.doMock("@/lib/notify", () => ({ sendAndLog: async (_c: unknown, deliver: () => Promise<unknown>) => void (await deliver()) }));
    vi.doMock("@/lib/whatsapp", async (orig) => ({
      ...(await orig<object>()),
      sendDinaChoices: async (_f: string, _t: string, m: { body: string; options: { id: string }[] }) => (out.push({ text: m.body, buttons: m.options.map((o) => o.id) }), { sid: "SM", body: m.body }),
    }));
    const flow = await import("@/lib/review/flow-run");
    const turn = {
      ctx: { restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() },
      channel: { restaurantId: R, from: "whatsapp:+14155238886", to: "whatsapp:+447700900158" },
      owner: "whatsapp:+447700900158",
      send: async (t: string, target?: { draftId?: string }) => void out.push({ text: t, buttons: target && typeof target === "object" && target.draftId ? [`approve:${target.draftId}`] : [] }),
    } as never;
    await flow.handleReviewFlow(turn, "GO", undefined);
    expect(out.at(-1)!.text).toMatch(/I've drafted replies to 8 of your 4 to 5 star reviews/);
    expect(out.at(-1)!.text).toMatch(/7 more need a closer look/);
    expect(out.at(-1)!.buttons).toEqual([`review:${RV}:replies:all`, `review:${RV}:replies:one`, `review:${RV}:replies:skip`]);
    await flow.handleReviewFlow(turn, "", `review:${RV}:replies:all`);
    expect(out.at(-2)!.text).toMatch(/^✅ Approved 8 replies\. They're posted to your test Google page now/);
    expect(out.at(-1)!.text).toBe("Next? Up next: replies to the harder reviews.");
    await flow.handleReviewFlow(turn, "", `review:${RV}:next`);
    expect(out.at(-2)!.text).toMatch(/7 replies need your eye/);
    expect(out.at(-1)!.text).toMatch(/^\*1 of 7\*/);
    const first = out.at(-1)!.buttons[0].replace("approve:", "");
    // The owner skips it (the usual decisions do that), then the next one shows.
    Object.assign(db.tables.drafts.find((d) => d.id === first)!, { status: "skipped" });
    await flow.afterReviewDecision(turn, { id: first, business_review_id: RV });
    expect(out.at(-1)!.text).toMatch(/^\*2 of 7\*/);
    for (const m of ["@/lib/notify", "@/lib/whatsapp"]) vi.doUnmock(m);
  });
});

describe("old reviews, 15 a day (8 Nov 2026)", () => {
  test("the order: 1 to 3 stars first, then the newest; none over a year old or already answered", async () => {
    const { backlogOrder } = await import("@/lib/review/parts/reviews");
    const now = new Date("2026-11-08T09:00:00Z");
    const rows = [
      { id: "a", rating: 5, review_date: "2026-11-01T00:00:00Z", replied: false, reply_text: null },
      { id: "b", rating: 2, review_date: "2026-06-01T00:00:00Z", replied: false, reply_text: null },
      { id: "c", rating: 4, review_date: "2026-10-01T00:00:00Z", replied: false, reply_text: null },
      { id: "d", rating: 1, review_date: "2025-01-01T00:00:00Z", replied: false, reply_text: null }, // over a year old
      { id: "e", rating: 3, review_date: "2026-11-02T00:00:00Z", replied: true, reply_text: "Thanks" }, // answered
    ];
    expect(backlogOrder(rows, now).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  test("each morning the next 15 get a held draft (for that brief), once a day, only with Google connected", async () => {
    const { dailyBacklog } = await import("@/lib/review/parts/reviews");
    const r = db.tables.restaurants[0] as never;
    const now = new Date(); // (the drafts are stamped with the real clock)
    const saved = { ...(db.tables.business_reviews[0] as Record<string, unknown>) };
    Object.assign(db.tables.business_reviews[0], { google_connected: false });
    expect(await dailyBacklog(r, now)).toMatchObject({ drafted: 0, skipped: "Google isn't connected" });
    Object.assign(db.tables.business_reviews[0], { ...saved, google_connected: true });
    expect(await dailyBacklog(r, now)).toMatchObject({ drafted: 15, left: 7 });
    expect(await dailyBacklog(r, now)).toMatchObject({ drafted: 0 }); // today's 15 are done
    expect(await dailyBacklog(r, new Date(now.getTime() + 24 * 3_600_000))).toMatchObject({ drafted: 7, left: 0 });
  });
});
