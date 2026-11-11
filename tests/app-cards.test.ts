// The app's Inbox cards and Today numbers (step 50, phase 1), and the decision
// endpoint's rules: a draft from another restaurant is never touched, and every
// decision runs through the bot's own code.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { approveAllEligible, cardChecks, cardTitle, categoryOf, messageType, sortCards, takingsLine, toCard, typeTiles, waitingSummary, type InboxCard } from "@/lib/app/cards";
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

  test("a bad review needs a look, a good one is simple (the owner's table); a question is answered, not approved", () => {
    expect(toCard(draft(), { review, body: "x" })).toMatchObject({ category: "look", type: { key: "review_poor" }, urgent: false });
    expect(toCard(draft(), { review: { ...review, rating: 5 }, body: "x" })).toMatchObject({ category: "simple", type: { key: "review_good" } });
    expect(toCard(draft({ kind: "rota" }), { review: null, body: "x" })).toMatchObject({ category: "urgent", urgent: true });
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

  test("sorted by category (urgent, needs a look, not urgent, simple), then type, then oldest", () => {
    const c = (id: string, category: InboxCard["category"], key: InboxCard["type"]["key"], at: string) => ({ id, category, type: { key, label: key }, waitingSince: at }) as InboxCard;
    expect(
      sortCards([c("good", "simple", "review_good", "0"), c("post", "later", "google_post", "1"), c("offer", "look", "email_offer", "3"), c("rota", "urgent", "rota", "4"), c("poor", "look", "review_poor", "2")]).map((x) => x.id),
    ).toEqual(["rota", "poor", "offer", "post", "good"]);
  });

  test("the owner's categories for every message type (12 Nov)", () => {
    expect(messageType("review_reply", 5, false).key).toBe("review_good");
    expect(messageType("review_reply", 4, false).key).toBe("review_good");
    expect(messageType("review_reply", 3, false).key).toBe("review_poor");
    expect(messageType("email_campaign", null, true)).toEqual({ key: "birthday_email", label: "Birthday emails" });
    expect(messageType("email_campaign", null, false).key).toBe("email_offer");
    expect(messageType("made_up_kind", null, false).key).toBe("other");
    const table: Record<string, InboxCard["category"]> = {
      review_good: "simple",
      review_poor: "look",
      review_question: "look",
      google_post: "later",
      email_offer: "look",
      birthday_email: "simple",
      import_welcome: "look",
      rota: "urgent",
      hours_update: "look",
      menu_update: "look",
      hours_question: "look",
      profile_fix: "look",
      profile_change: "look",
      agent_question: "urgent",
      choice: "urgent",
      special_idea: "later",
    };
    for (const [key, category] of Object.entries(table)) expect(categoryOf(key as InboxCard["type"]["key"], false), key).toBe(category);
  });

  test("a flagged draft always needs a look (urgent stays urgent); Approve all only takes simple ones with every check passed", () => {
    expect(categoryOf("review_good", true)).toBe("look");
    expect(categoryOf("google_post", true)).toBe("look");
    expect(categoryOf("rota", true)).toBe("urgent");
    const pass = [{ status: "pass" as const }, { status: "fixed" as const }];
    expect(approveAllEligible("simple", pass)).toBe(true);
    expect(approveAllEligible("simple", [{ status: "held" as const }])).toBe(false);
    expect(approveAllEligible("simple", [])).toBe(false); // never checked: not in Approve all
    expect(approveAllEligible("later", pass)).toBe(false); // not urgent: a tick each, never all at once
  });

  test("Today's tiles: one per type with its count, none at zero, a flagged one marking its tile", () => {
    const card = (key: InboxCard["type"]["key"], category: InboxCard["category"]) => ({ type: { key, label: key }, category });
    expect(typeTiles([card("review_good", "simple"), card("review_good", "simple"), card("review_good", "look"), card("rota", "urgent"), card("google_post", "later")])).toEqual([
      { key: "rota", label: "rota", category: "urgent", count: 1 },
      { key: "review_good", label: "review_good", category: "look", count: 3 },
      { key: "google_post", label: "google_post", category: "later", count: 1 },
    ]);
    expect(typeTiles([])).toEqual([]);
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
