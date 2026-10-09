// The morning brief's wording, and APPROVE ALL (database and sending replaced by stand-ins).
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "./support/fake-supabase";

const draft = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: "r1",
  kind: "review_reply",
  content: `Reply ${id}`,
  audience: `Google review by ${id}`,
  status: "pending",
  waiting_for: null,
  version: 1,
  review_id: `rev-${id}`,
  checks: null,
  check_notes: null,
  brief_number: null,
  briefed_at: null,
  ...extra,
});
const reviews = new Map([
  ["rev-a", { id: "rev-a", author_name: "Aisha R.", rating: 5, text: "Lovely" }],
  ["rev-b", { id: "rev-b", author_name: "Peter W.", rating: 2, text: "Cold naan" }],
]);
const restaurant = { discount_cap_percent: 20 };

describe("the morning brief", () => {
  test("a numbered list, a done-for-you line, then each item with its own message", async () => {
    const { composeBrief } = await import("@/lib/brief");
    const b = composeBrief({
      items: [draft("a"), draft("b")] as never,
      totalWaiting: 2,
      reviews,
      names: new Map(),
      tally: ["replied to 3 reviews", "4 new sign-ups"],
      restaurant,
    });
    expect(b.summary).toContain("2 things need your OK");
    expect(b.summary).toContain("1. 📝 Reply to Aisha R's 5⭐ review");
    expect(b.summary).toContain("2. 📝 Reply to Peter W's 2⭐ review 🚨");
    expect(b.summary).toContain("Done for you since yesterday:* Replied to 3 reviews, 4 new sign-ups.");
    expect(b.summary).toContain("APPROVE ALL");
    expect(b.itemMessages).toHaveLength(2);
    expect(b.itemMessages[1]).toMatch(/^\*2 of 2\*/);
  });
  test("nothing to approve: just the tally", async () => {
    const { composeBrief } = await import("@/lib/brief");
    const b = composeBrief({ items: [], totalWaiting: 0, reviews, names: new Map(), tally: ["2 new sign-ups"], restaurant });
    expect(b.summary).toContain("Nothing needs your OK today");
    expect(b.summary).not.toContain("APPROVE ALL");
    expect(b.itemMessages).toEqual([]);
  });
  test("more than 10 waiting: the rest wait for tomorrow", async () => {
    const { composeBrief } = await import("@/lib/brief");
    const b = composeBrief({ items: [draft("a")] as never, totalWaiting: 14, reviews, names: new Map(), tally: [], restaurant });
    expect(b.summary).toContain("…and 13 more");
  });
});

describe("APPROVE ALL", () => {
  beforeEach(() => vi.resetModules());

  test("approves every item still waiting from the latest brief, as one batch, each through the safety rules", async () => {
    const left = [draft("a", { brief_number: 1 }), draft("c", { brief_number: 3 })];
    const db = fakeSupabase(() => ({ data: left }));
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    const approveDraft = vi.fn(async (d: { id: string }) => ({ ...d, status: "approved" }));
    vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), approveDraft }));
    const attemptSend = vi.fn(async (id: string) =>
      id === "a"
        ? { outcome: "sent", draft: left[0] }
        : { outcome: "queued", reason: "outside_window", scheduledFor: new Date("2026-10-10T08:00:00Z"), detail: "", draft: left[1] },
    );
    vi.doMock("@/lib/send", () => ({ attemptSend }));

    const { approveAll } = await import("@/lib/brief");
    const text = await approveAll({ id: "r1", last_brief_at: "2026-10-09T08:05:00Z" } as never, new Date("2026-10-09T21:30:00Z"));

    expect(approveDraft).toHaveBeenCalledTimes(2);
    const batchIds = approveDraft.mock.calls.map((c) => (c as unknown[])[1]);
    expect(batchIds[0]).toBeTruthy();
    expect(batchIds[0]).toBe(batchIds[1]); // one UNDO undoes them all
    expect(attemptSend).toHaveBeenCalledTimes(2);
    expect(text).toContain("Approved 2 items");
    expect(text).toContain("1. ✅");
    expect(text).toContain("3. 🕘");
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/drafts");
    vi.doUnmock("@/lib/send");
  });

  test("nothing left, or no brief yet: says so, approves nothing", async () => {
    const db = fakeSupabase(() => ({ data: [] }));
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    const { approveAll } = await import("@/lib/brief");
    expect(await approveAll({ id: "r1", last_brief_at: "2026-10-09T08:05:00Z" } as never, new Date())).toMatch(/already been dealt with/);
    expect(await approveAll({ id: "r1", last_brief_at: null } as never, new Date())).toMatch(/no brief/);
    vi.doUnmock("@/lib/supabase");
  });
});
