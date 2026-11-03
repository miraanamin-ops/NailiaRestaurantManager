// Time saved and the evening receipt (step 10): 8pm, or 2 hours after the review
// if later, never after 9pm (then the morning brief); sent once; WhatsApp's
// 24-hour window closed means the brief; the running total in the brief and the
// Monday report; each piece of work counts once.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { receiptText, receiptTime } from "@/lib/review/rules";

describe("when the receipt goes (UK time)", () => {
  test("8pm, or 2 hours after the review if later, never after 9pm", () => {
    // 3 November: GMT, so UK time = UTC.
    expect(receiptTime(new Date("2026-11-03T14:00:00Z"))?.toISOString()).toBe("2026-11-03T20:00:00.000Z");
    expect(receiptTime(new Date("2026-11-03T18:30:00Z"))?.toISOString()).toBe("2026-11-03T20:30:00.000Z");
    expect(receiptTime(new Date("2026-11-03T19:00:00Z"))?.toISOString()).toBe("2026-11-03T21:00:00.000Z");
    expect(receiptTime(new Date("2026-11-03T19:30:00Z"))).toBeNull();
    expect(receiptTime(new Date("2026-11-03T22:00:00Z"))).toBeNull();
    // Summer (BST): 8pm UK is 19:00 UTC.
    expect(receiptTime(new Date("2027-06-03T10:00:00Z"))?.toISOString()).toBe("2027-06-03T19:00:00.000Z");
  });

  test("the words: approved, still waiting, about how long", () => {
    expect(receiptText({ posted: { replies: 15, profile: true, posts: 0, campaigns: 0 }, waiting: { replies: 7, profile: 0, posts: 2, campaigns: 2 }, minutes: 260 })).toBe(
      [
        "🧾 *Your business review, so far*",
        "",
        "✅ Approved and on their way: 15 review replies and your Google profile fixes.",
        "⏳ Still waiting for you: 7 review replies, 2 Google posts and 2 campaigns. They're in tomorrow morning's brief.",
        "⏱️ That's about 4.5 hours of work saved.",
      ].join("\n"),
    );
    expect(receiptText({ posted: { replies: 0, profile: false, posts: 0, campaigns: 0 }, waiting: { replies: 0, profile: 0, posts: 0, campaigns: 0 }, minutes: 0 })).toMatch(/Nothing approved yet\.\n⏳ Nothing left waiting/);
  });
});

const R = "efefefef-0000-4000-8000-000000000058";
const RV = "efefefef-0000-4000-8000-00000000a058";
let db: ReturnType<typeof memoryDb>;
const sent: string[] = [];
let windowOpen = true;
let queued: { type: string; key: string; runAt?: Date }[] = [];

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  queued = [];
  windowOpen = true;
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice", owner_whatsapp: "whatsapp:+447700900158", whatsapp_from: "whatsapp:+14155238886", is_demo: true }],
    business_reviews: [{ id: RV, restaurant_id: R, status: "sent", sent_at: "2026-11-03T14:00:00Z", receipt_due_at: null, receipt_sent_at: null, created_at: "2026-11-03T13:50:00Z" }],
    drafts: [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, restaurant_id: R, business_review_id: RV, kind: "review_reply", status: "sent" })),
      { id: "p1", restaurant_id: R, business_review_id: RV, kind: "review_reply", status: "pending" },
      { id: "f1", restaurant_id: R, business_review_id: RV, kind: "profile_fix", status: "sent" },
      { id: "x1", restaurant_id: R, business_review_id: null, kind: "review_reply", status: "pending" }, // not the review's
    ],
    time_saved_log: [
      { restaurant_id: R, action: "review_reply", ref: "s0", minutes: 4, logged_at: "2026-11-03T13:55:00Z" },
      { restaurant_id: R, action: "profile_fix", ref: "f1:phone", minutes: 10, logged_at: "2026-11-03T13:56:00Z" },
      { restaurant_id: R, action: "rival_check", ref: "x", minutes: 30, logged_at: "2026-10-01T10:00:00Z" },
    ],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/brief", () => ({ canMessageFreely: async () => windowOpen }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void sent.push(text) }));
  vi.doMock("@/lib/queue/store", () => ({ enqueue: async (i: { type: string; key: string; runAt?: Date }) => (queued.push(i), { id: i.key }) }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/brief", "@/lib/notify", "@/lib/queue/store"]) vi.doUnmock(m);
});
const review = () => db.tables.business_reviews[0];

describe("the receipt", () => {
  test("scheduled for 8pm; sent once, with what the review drafted (not other drafts)", async () => {
    const { scheduleReceipt, receiptHandler } = await import("@/lib/review/receipt");
    await scheduleReceipt(RV, { id: R }, new Date("2026-11-03T14:00:00Z"));
    expect(queued).toEqual([expect.objectContaining({ type: "business_review_receipt", key: `business_review_receipt:${RV}`, runAt: new Date("2026-11-03T20:00:00Z") })]);
    expect(review().receipt_due_at).toBe("2026-11-03T20:00:00.000Z");
    await receiptHandler.run({ payload: { reviewId: RV } } as never);
    await receiptHandler.run({ payload: { reviewId: RV } } as never);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/Approved and on their way: 3 review replies and your Google profile fixes\./);
    expect(sent[0]).toMatch(/Still waiting for you: 1 review reply\./);
    expect(sent[0]).toMatch(/about 15 minutes of work saved/);
  });

  test("WhatsApp's window closed: not sent; it's in the next morning brief instead (once)", async () => {
    windowOpen = false;
    const { receiptHandler, reviewBriefSection } = await import("@/lib/review/receipt");
    review().receipt_due_at = "2026-11-03T20:00:00Z";
    expect(await receiptHandler.run({ payload: { reviewId: RV } } as never)).toEqual({ skipped: "goes in the morning brief" });
    expect(sent).toEqual([]);
    const morning = new Date("2026-11-04T09:00:00Z");
    const block = await reviewBriefSection.block({ restaurant: db.tables.restaurants[0] as never, now: morning });
    expect(String(block)).toMatch(/^🧾 \*Your business review, so far\*/);
    // The next morning: the running total instead.
    const next = await reviewBriefSection.block({ restaurant: db.tables.restaurants[0] as never, now: new Date("2026-11-05T09:00:00Z") });
    expect(next).toBe("⏱️ About 45 minutes of work saved by DinerAI so far.");
  });

  test("too late in the evening: no job, straight to the brief", async () => {
    const { scheduleReceipt, reviewBriefSection } = await import("@/lib/review/receipt");
    await scheduleReceipt(RV, { id: R }, new Date("2026-11-03T20:30:00Z"));
    expect(queued).toEqual([]);
    expect(review().receipt_due_at).toBeNull();
    expect(String(await reviewBriefSection.block({ restaurant: db.tables.restaurants[0] as never, now: new Date("2026-11-04T09:00:00Z") }))).toMatch(/🧾/);
  });

  test("the Monday report: hours saved last week against the week before, and the total", async () => {
    const { timeSavedReportSection } = await import("@/lib/review/receipt");
    const s = await timeSavedReportSection.build({ restaurant: db.tables.restaurants[0] as never, period: { prevStart: new Date("2026-10-26T00:00:00Z"), start: new Date("2026-11-02T00:00:00Z"), end: new Date("2026-11-09T00:00:00Z") } });
    expect(s).toMatchObject({ title: "Time saved", stats: [{ label: "Hours saved (about)", value: { now: 0, before: 0 } }] });
    expect(s!.lines[0]).toMatch(/^About 45 minutes of work done for you so far/);
  });
});

describe("time saved counts each piece of work once", () => {
  test("logging the same action twice (a retried job) keeps one row", async () => {
    const { logTimeSaved, minutesSavedTotal } = await import("@/lib/review/time-saved");
    await logTimeSaved(R, "poster", `${RV}:poster`);
    await logTimeSaved(R, "poster", `${RV}:poster`);
    expect(db.tables.time_saved_log.filter((x) => x.action === "poster")).toHaveLength(1);
    expect(await minutesSavedTotal(R)).toBe(4 + 10 + 30 + 30);
  });
});
