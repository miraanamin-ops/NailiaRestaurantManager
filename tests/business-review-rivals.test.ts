// You vs nearby rivals (step 7): Places API (New) Nearby Search for the closest
// 5 with the same primary category within a mile, ours dropped; only their
// place ids are stored; the page fetches the rest fresh; test and demo sites use
// fixtures and never call Google; the daily cap counts every call.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { nearbyAverage } from "@/lib/review/rules";

const R = "acac0000-0000-4000-8000-000000000058";
let db: ReturnType<typeof memoryDb>;
const requests: { url: string; body: unknown; mask: string }[] = [];

beforeEach(() => {
  vi.resetModules();
  requests.length = 0;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice", address: "1 Whitechapel Rd", google_place_id: "ours", is_demo: false, is_test: false }],
    rival_places: [],
    rate_limits: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, mask: headers["X-Goog-FieldMask"] });
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.endsWith("/places/ours")) return json({ id: "ours", location: { latitude: 51.5, longitude: -0.07 }, primaryType: "halal_restaurant", rating: 4.4, userRatingCount: 132 });
    if (url.endsWith("/places:searchNearby"))
      return json({
        places: [
          { id: "ours", displayName: { text: "Ember & Spice" }, rating: 4.4, userRatingCount: 132 },
          ...[4.5, 4.1, 4.3, 3.9, 4.2, 4.8].map((rating, i) => ({ id: `p${i}`, displayName: { text: `Rival ${i}` }, rating, userRatingCount: 100 + i })),
        ],
      });
    if (/\/places\/p\d$/.test(url)) return json({ id: url.split("/").at(-1), displayName: { text: "Fresh name" }, rating: 4.6, userRatingCount: 999 });
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
});

describe("rivals", () => {
  test("the nearby average across the rivals that have a rating", () => {
    expect(nearbyAverage([{ rating: 4.5 }, { rating: 4.1 }, { rating: null }])).toEqual({ average: 4.3, n: 2 });
    expect(nearbyAverage([])).toBeNull();
  });

  test("Nearby Search: same primary category, within a mile, closest first; ours dropped; 5 kept; only ids stored", async () => {
    const { findRivals } = await import("@/lib/review/rivals");
    const out = await findRivals(db.tables.restaurants[0] as never);
    const search = requests.find((x) => x.url.endsWith("/places:searchNearby"))!;
    expect(search.body).toEqual({ includedPrimaryTypes: ["halal_restaurant"], maxResultCount: 6, rankPreference: "DISTANCE", locationRestriction: { circle: { center: { latitude: 51.5, longitude: -0.07 }, radius: 1609 } } });
    expect(search.mask).toBe("places.id,places.displayName,places.rating,places.userRatingCount");
    expect(out).toEqual({ ours: { rating: 4.4, count: 132 }, nearby: { average: 4.2, n: 5 } });
    expect(db.tables.rival_places.map((x) => Object.keys(x).sort())).toEqual(Array(5).fill(["created_at", "id", "place_id", "rank", "restaurant_id"]));
    expect(db.tables.rival_places.map((x) => x.place_id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    // Every call counted against the daily cap.
    expect(db.tables.rate_limits).toHaveLength(2);
  });

  test("the page fetches them fresh by id", async () => {
    const { findRivals, rivalsNow } = await import("@/lib/review/rivals");
    await findRivals(db.tables.restaurants[0] as never);
    const now = await rivalsNow(db.tables.restaurants[0] as never);
    expect(now).toHaveLength(5);
    expect(now[0]).toEqual({ id: "p0", name: "Fresh name", rating: 4.6, count: 999 });
  });

  test("test and demo sites use fixtures: no call to Google", async () => {
    db.tables.restaurants[0].is_demo = true;
    const { findRivals } = await import("@/lib/review/rivals");
    expect(await findRivals(db.tables.restaurants[0] as never)).toEqual({ ours: { rating: 4.4, count: 132 }, nearby: { average: 4.2, n: 5 } });
    expect(requests).toEqual([]);
    db.tables.restaurants[0].dummy_google_profile = { places: { ours: { rating: 4.8, count: 4 }, rivals: [] } };
    expect(await findRivals(db.tables.restaurants[0] as never)).toEqual({ ours: { rating: 4.8, count: 4 }, nearby: null });
  });

  test("no Places key: the part fails (its section drops out)", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const { findRivals } = await import("@/lib/review/rivals");
    await expect(findRivals(db.tables.restaurants[0] as never)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });
});
