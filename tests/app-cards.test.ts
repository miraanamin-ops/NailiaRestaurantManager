// The app's Inbox cards and Today numbers (step 50, phase 1), and the decision
// endpoint's rules: a draft from another restaurant is never touched, and every
// decision runs through the bot's own code.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { cardChecks, cardTitle, sortCards, takingsLine, tierOf, toCard, waitingSummary, type InboxCard } from "@/lib/app/cards";
import type { Draft } from "@/lib/drafts";

const draft = (fields: Partial<Draft> = {}): Draft =>
  ({ id: "d1", restaurant_id: "r1", kind: "review_reply", content: "Thanks Sam!", status: "pending", audience: null, created_at: "2026-11-10T09:00:00Z", checks: null, check_notes: null, ...fields }) as Draft;
const review = { author: "Sam K.", rating: 2, text: "Waited 40 minutes" };

describe("cards", () => {
  test("titles in plain words", () => {
    expect(cardTitle(draft(), review)).toBe("Reply to Sam K's 2-star review");
    expect(cardTitle(draft({ kind: "email_campaign", audience: "everyone" }), null, "Quiet Thursday")).toBe("Email: Quiet Thursday to everyone");
    expect(cardTitle(draft({ kind: "google_post" }), null)).toBe("Google post");
    expect(cardTitle(draft({ kind: "review_question" }), review)).toBe("Your call on Sam K's 2-star review");
  });

  test("a bad review is urgent; a question is answered, not approved", () => {
    expect(toCard(draft(), { review, body: "x" }).urgent).toBe(true);
    expect(toCard(draft(), { review: { ...review, rating: 5 }, body: "x" }).urgent).toBe(false);
    expect(toCard(draft({ kind: "review_question" }), { review, body: "x" }).actions).toBe("answer");
    expect(toCard(draft({ kind: "special_idea" }), { review: null, body: "x" }).actions).toEqual(["approve", "skip"]);
    expect(toCard(draft({ kind: "google_post" }), { review: null, body: "x" }).approveHint).toBe("Publishes this post on Google");
  });

  test("checks: send-time results win for compliance and money; flags mark the card", () => {
    const at = "2026-11-10T09:00:00Z";
    const checks = {
      tone: { status: "pass" as const, fixes: [], flags: [], at },
      money: { status: "pass" as const, fixes: [], flags: [], at },
      send: { money: { status: "flagged" as const, fixes: [], flags: ["Over your 20% cap"], at } },
    };
    expect(cardChecks(checks)).toEqual([
      { name: "tone", label: "Brand & tone", status: "pass", notes: [] },
      { name: "money", label: "Money & risk", status: "flagged", notes: ["Over your 20% cap"] },
    ]);
    expect(toCard(draft({ checks }), { review: null, body: "x" }).flagged).toBe(true);
    expect(cardChecks(null)).toEqual([]);
  });

  test("urgent first, then the ones to open (flagged first), then the simple ones; oldest first in each", () => {
    const c = (id: string, tier: InboxCard["tier"], flagged: boolean, at: string) => ({ id, tier, urgent: tier === "urgent", flagged, waitingSince: at }) as InboxCard;
    expect(sortCards([c("old", "look", false, "1"), c("easy", "simple", false, "0"), c("flag", "look", true, "3"), c("urgent", "urgent", false, "4"), c("new", "look", false, "2")]).map((x) => x.id)).toEqual(["urgent", "flag", "old", "new", "easy"]);
  });

  test("only clean 4 to 5 star replies and Google posts are simple (one tap from the list)", () => {
    const pass = [{ name: "brand", label: "Brand", status: "pass" as const, notes: [] }, { name: "facts", label: "Facts", status: "fixed" as const, notes: [] }];
    const base = { urgent: false, flagged: false, checks: pass, review: null, actions: ["approve", "edit", "skip"] as InboxCard["actions"] };
    expect(tierOf({ ...base, kind: "review_reply", review: { author: "A", rating: 5, text: "x" } })).toBe("simple");
    expect(tierOf({ ...base, kind: "google_post" })).toBe("simple");
    expect(tierOf({ ...base, kind: "review_reply", review: { author: "A", rating: 2, text: "x" }, urgent: true })).toBe("urgent");
    expect(tierOf({ ...base, kind: "email_campaign" })).toBe("look"); // customers and a discount: always opened first
    expect(tierOf({ ...base, kind: "rota" })).toBe("look");
    expect(tierOf({ ...base, kind: "google_post", flagged: true })).toBe("look");
    expect(tierOf({ ...base, kind: "google_post", checks: [{ ...pass[0], status: "flagged" }] })).toBe("look");
    expect(tierOf({ ...base, kind: "google_post", checks: [] })).toBe("look"); // never checked: open it
    expect(tierOf({ ...base, kind: "review_question", actions: "answer" })).toBe("look");
  });

  test("summary and takings in plain words", () => {
    expect(waitingSummary([{ kind: "review_reply" }, { kind: "review_reply" }, { kind: "email_campaign" }])).toEqual({ count: 3, line: "2 review replies, 1 email" });
    expect(waitingSummary([]).count).toBe(0);
    expect(takingsLine(2340, 2166)).toEqual({ amount: "£2,340", change: "+8% vs last week" });
    expect(takingsLine(1800, 2000)).toEqual({ amount: "£1,800", change: "-10% vs last week" });
    expect(takingsLine(1800, null)).toEqual({ amount: "£1,800", change: null });
    expect(takingsLine(null, 2000)).toBeNull();
  });
});

describe("the decision endpoint", () => {
  const decide = vi.fn(async () => ({ ok: true as const, replies: ["Approved"], card: null }));
  let draftRow: { restaurant_id: string } | null = { restaurant_id: "11111111-1111-4111-8111-111111111111" };
  const D = "dddddddd-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.resetModules();
    decide.mockClear();
    draftRow = { restaurant_id: "11111111-1111-4111-8111-111111111111" };
    vi.doMock("@/lib/app-api", async (orig) => ({
      ...(await orig<object>()),
      withOwner: async (_req: unknown, run: (o: unknown) => Promise<Response>) => run({ email: "sam@ember.test", isBuilder: false, restaurantIds: ["11111111-1111-4111-8111-111111111111"], allowed: true }),
    }));
    vi.doMock("@/lib/app/inbox", () => ({ decideFromApp: decide }));
    vi.doMock("@/lib/supabase", async (orig) => ({
      ...(await orig<object>()),
      getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draftRow, error: null }) }) }) }) }),
    }));
  });
  afterEach(() => {
    for (const m of ["@/lib/app-api", "@/lib/app/inbox", "@/lib/supabase"]) vi.doUnmock(m);
  });

  const call = async (body: unknown, id = D) => {
    const { POST } = await import("@/app/api/app/drafts/[id]/route");
    return POST(new NextRequest(`https://app.test/api/app/drafts/${id}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  };

  test("approve, skip, edit with words, and a reason go through", async () => {
    for (const body of [{ action: "approve" }, { action: "skip" }, { action: "edit", instructions: "shorter please" }, { action: "reason", reason: "wrong tone" }]) {
      expect((await call(body)).status).toBe(200);
    }
    expect(decide).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", D, { action: "edit", instructions: "shorter please" });
  });

  test("an edit with no words, or an unknown action, is refused", async () => {
    expect((await call({ action: "edit", instructions: "  " })).status).toBe(400);
    expect((await call({ action: "delete" })).status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  test("another restaurant's draft, or no such draft, is 'not found' and untouched", async () => {
    draftRow = { restaurant_id: "22222222-2222-4222-8222-222222222222" };
    expect((await call({ action: "approve" })).status).toBe(404);
    draftRow = null;
    expect((await call({ action: "approve" })).status).toBe(404);
    expect((await call({ action: "approve" }, "not-a-uuid")).status).toBe(404);
    expect(decide).not.toHaveBeenCalled();
  });
});
