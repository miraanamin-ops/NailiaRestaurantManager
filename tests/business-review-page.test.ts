// The review page's data (step 11): only for a restaurant this person may see;
// every section from what the review saved; rivals fetched fresh.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

const R = "aeae0000-0000-4000-8000-000000000058";
const OTHER = "aeae0000-0000-4000-8000-000000000059";
const RV = "aeae0000-0000-4000-8000-00000000a058";
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [
      { id: R, name: "Ember & Spice", slug: "ember-spice", is_demo: true, owner_name: "Sam" },
      { id: OTHER, name: "Elsewhere", slug: "elsewhere", is_demo: true },
    ],
    business_reviews: [{ id: RV, restaurant_id: R, status: "sent", google_connected: true, created_at: "2026-11-03T10:00:00Z" }],
    business_review_parts: [
      { review_id: RV, restaurant_id: R, part: "rivals", status: "done", result: { ours: { rating: 4.4, count: 132 }, nearby: { average: 4.2, n: 5 } } },
      { review_id: RV, restaurant_id: R, part: "profile", status: "done", result: { score: 64, fixes: 3, examples: [], asks: ["your Christmas and New Year hours"], copyPaste: 1, steps: [{ label: "A cover photo", text: "In Google..." }], items: [{ key: "phone", label: "A phone number", points: 0, max: 6 }] } },
      { review_id: RV, restaurant_id: R, part: "poster", status: "done", result: { ready: true } },
    ],
    rival_places: ["fixture-rival-1", "fixture-rival-3"].map((place_id, i) => ({ restaurant_id: R, place_id, rank: i + 1 })),
    drafts: [{ id: "c1", restaurant_id: R, business_review_id: RV, kind: "email_campaign", status: "pending", content: "Bonfire Night offer", audience: "everyone" }],
    time_saved_log: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

test("someone who can't see the restaurant gets nothing", async () => {
  const { reviewPageFor } = await import("@/lib/review/page-data");
  expect(await reviewPageFor({ restaurantIds: [OTHER] } as never, "ember-spice")).toBeNull();
});

test("the owner gets every section; rivals fetched by their stored ids", async () => {
  const { reviewPageFor } = await import("@/lib/review/page-data");
  const page = (await reviewPageFor({ restaurantIds: [R] } as never, "ember-spice"))!;
  expect(page.lines[0]).toBe("⭐ 4.4 from 132 Google reviews. Nearby average: 4.2 across 5 local rivals.");
  expect(page.profile?.score).toBe(64);
  expect(page.rivals?.list.map((x) => x.name)).toEqual(["Charcoal House", "Brick Lane Grill"]);
  expect(page.planned.map((d) => d.content)).toEqual(["Bonfire Night offer"]);
  expect(page.poster).toBe(true);
});
