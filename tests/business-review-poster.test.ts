// The QR poster (step 9): print-ready A4 and A5 PDFs with the name, the reward
// and a QR code to the sign-up page; the brand's colours or a clean default;
// the part draws both before the message promises it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

const pageSize = (pdf: Buffer) => pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/)?.slice(1).map((x) => Math.round(Number(x)));

describe("the poster", () => {
  test("A4 and A5, one page each, real PDFs", async () => {
    const { renderPoster } = await import("@/lib/onboarding/qr-pack");
    const brand = { name: "Ember & Spice", tagline: "Charcoal grill", brand_color: "#e11d48", brand_dark: "#1f2937", signup_reward: "a free mango lassi" };
    const a4 = await renderPoster(brand, "https://app.test/r/ember-spice", "A4");
    const a5 = await renderPoster(brand, "https://app.test/r/ember-spice", "A5");
    expect(a4.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageSize(a4)).toEqual([595, 842]);
    expect(pageSize(a5)).toEqual([420, 595]);
  }, 30_000);

  test("no brand colours or reward: a clean default, never a broken poster", async () => {
    const { renderPoster } = await import("@/lib/onboarding/qr-pack");
    const pdf = await renderPoster({ name: "New Cafe", brand_color: null as never, brand_dark: null as never, signup_reward: null, tagline: null }, "https://app.test/r/new-cafe", "A4");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});

const R = "adad0000-0000-4000-8000-000000000058";
const RV = "adad0000-0000-4000-8000-00000000a058";
let db: ReturnType<typeof memoryDb>;
beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice", slug: "ember-spice", signup_reward: "a free mango lassi", brand_color: null, brand_dark: null }],
    business_reviews: [{ id: RV, restaurant_id: R, status: "sent", google_connected: false, flow_state: {}, created_at: new Date().toISOString() }],
    business_review_parts: [],
    time_saved_log: [],
    audit_log: [],
    drafts: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

describe("the poster part and its step", () => {
  test("drawn in both sizes, time saved logged, then sent as a PDF in the guided flow", async () => {
    const { posterPart } = await import("@/lib/review/parts/poster");
    expect(await posterPart({ review: db.tables.business_reviews[0] as never, restaurant: db.tables.restaurants[0] as never, now: new Date(), connected: false, round: 0 })).toEqual({ ready: true });
    expect(db.tables.time_saved_log.map((x) => x.action)).toEqual(["poster"]);
    db.tables.business_review_parts.push({ review_id: RV, restaurant_id: R, part: "poster", status: "done", result: { ready: true } });
    const sent: { text: string; media: string | null }[] = [];
    const flow = await import("@/lib/review/flow-run");
    const turn = {
      ctx: { restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() },
      channel: { restaurantId: R, from: "a", to: "b" },
      owner: "b",
      send: async (text: string, _b?: unknown, media: string | null = null) => void sent.push({ text, media }),
    } as never;
    await flow.handleReviewFlow(turn, "GO", undefined);
    expect(sent[0]).toEqual({ text: "", media: "https://app.test/r/ember-spice/poster?size=A4" });
    expect(sent[1].text).toMatch(/^🪧 \*Your QR poster\*/);
    expect(sent[1].text).toContain("A5 for the tables: https://app.test/r/ember-spice/poster?size=A5");
    expect(sent.at(-1)!.text).toMatch(/^That's everything from your review/);
  }, 30_000);
});
