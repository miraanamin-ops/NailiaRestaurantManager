// Approve and Skip from the owner's web pages (lib/web-decisions.ts): only the
// owner's own restaurant, only drafts still waiting, only kinds that don't need a
// WhatsApp conversation, and approving always goes through attemptSend's rules.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "./support/fake-supabase";

const restaurant = { id: "r1", name: "Ember", fake_now: null, is_demo: true };
const draft = (extra: Record<string, unknown> = {}) => ({
  id: "d1",
  restaurant_id: "r1",
  kind: "review_reply",
  content: "Thanks *Daniel*!",
  audience: "Google review by Daniel",
  status: "pending",
  waiting_for: null,
  version: 1,
  ...extra,
});

function setup(d: Record<string, unknown> | null) {
  const db = fakeSupabase((call) => {
    if (call.table === "restaurants") return { data: restaurant };
    if (call.table === "drafts" && call.op === "select") {
      // The draft is only found when asked for with its own restaurant.
      const rid = call.filters.find((f) => f[0] === "eq" && f[1] === "restaurant_id")?.[2];
      return { data: d && rid === d.restaurant_id ? d : null };
    }
    return { data: null };
  });
  vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client, restaurantNow: () => new Date("2026-11-07T10:00:00Z") }));
  const logAction = vi.fn(async () => undefined);
  vi.doMock("@/lib/audit", () => ({ logAction }));
  const approveDraft = vi.fn(async (x: { id: string }) => ({ ...x, status: "approved" }));
  const updateDraft = vi.fn(async (id: string, fields: object) => ({ id, ...fields }));
  const saveSkipReason = vi.fn(async () => undefined);
  vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), approveDraft, updateDraft, saveSkipReason, check: (r: { data: unknown }) => r.data }));
  const attemptSend = vi.fn(async () => ({ outcome: "sent", draft: d }));
  vi.doMock("@/lib/send", () => ({ attemptSend }));
  return { db, logAction, approveDraft, updateDraft, saveSkipReason, attemptSend };
}

describe("web decisions", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    for (const m of ["@/lib/supabase", "@/lib/audit", "@/lib/drafts", "@/lib/send"]) vi.doUnmock(m);
  });

  test("approve: recorded, then through the safety rules; the answer has no WhatsApp formatting", async () => {
    const s = setup(draft());
    const { decideFromWeb } = await import("@/lib/web-decisions");
    const out = await decideFromWeb({ restaurantIds: ["r1"] }, "r1", "d1", "approve");
    expect(s.approveDraft).toHaveBeenCalledOnce();
    expect(s.attemptSend).toHaveBeenCalledWith("d1", restaurant, expect.any(Date), "approve");
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/^✅ Approved and sent/);
    expect(out.message).not.toContain("*");
  });

  test("another restaurant's draft: refused before anything is read or sent", async () => {
    const s = setup(draft({ restaurant_id: "r2" }));
    const { decideFromWeb } = await import("@/lib/web-decisions");
    expect((await decideFromWeb({ restaurantIds: ["r1"] }, "r2", "d1", "approve")).ok).toBe(false);
    // Asking as r1 for r2's draft finds nothing.
    expect((await decideFromWeb({ restaurantIds: ["r1"] }, "r1", "d1", "approve")).message).toMatch(/couldn't find/);
    expect(s.approveDraft).not.toHaveBeenCalled();
    expect(s.attemptSend).not.toHaveBeenCalled();
  });

  test("not waiting any more, or a WhatsApp-only kind: nothing happens", async () => {
    const s = setup(draft({ status: "sent" }));
    const { decideFromWeb } = await import("@/lib/web-decisions");
    expect((await decideFromWeb({ restaurantIds: ["r1"] }, "r1", "d1", "approve")).message).toMatch(/isn't waiting/);
    vi.resetModules();
    setup(draft({ kind: "review_question" }));
    const again = await import("@/lib/web-decisions");
    expect((await again.decideFromWeb({ restaurantIds: ["r1"] }, "r1", "d1", "skip")).message).toMatch(/WhatsApp/);
    expect(s.attemptSend).not.toHaveBeenCalled();
  });

  test("skip: marked skipped, logged as the owner, the reason saved to learn from", async () => {
    const s = setup(draft());
    const { decideFromWeb } = await import("@/lib/web-decisions");
    const out = await decideFromWeb({ restaurantIds: ["r1"] }, "r1", "d1", "skip", "  too formal ");
    expect(s.updateDraft).toHaveBeenCalledWith("d1", { status: "skipped", waiting_for: null });
    expect(s.logAction).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: "r1", actor: "owner", action: "skipped" }));
    expect(s.saveSkipReason).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "too formal");
    expect(s.attemptSend).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });
});
