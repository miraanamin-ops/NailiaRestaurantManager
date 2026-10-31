// Our own daily cap on Google Places calls (src/lib/onboarding/places.ts): after
// PLACES_DAILY_MAX calls in a day no more go to Google, and if the count can't be
// read none go at all, so a key can't run up a bill through the app.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

let db: ReturnType<typeof memoryDb>;
const fetched: string[] = [];

beforeEach(() => {
  vi.resetModules();
  fetched.length = 0;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.PLACES_DAILY_MAX = "2";
  db = memoryDb({ rate_limits: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.stubGlobal("fetch", async (url: string) => (fetched.push(url), new Response(JSON.stringify({ places: [{ id: "p1", displayName: { text: "Ember Grill" }, formattedAddress: "12 High St" }] }))));
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.unstubAllGlobals();
  delete process.env.PLACES_DAILY_MAX;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

test("after the day's cap, no more calls reach Google", async () => {
  const { searchPlaces, PlacesCapReached } = await import("@/lib/onboarding/places");
  expect(await searchPlaces("Ember Grill")).toEqual([{ id: "p1", name: "Ember Grill", address: "12 High St" }]);
  await searchPlaces("Ember Grill");
  await expect(searchPlaces("Ember Grill")).rejects.toBeInstanceOf(PlacesCapReached);
  expect(fetched).toHaveLength(2);
});

test("if the count can't be read, nothing goes to Google", async () => {
  vi.doMock("@/lib/supabase", async (orig) => ({
    ...(await orig<object>()),
    getSupabase: () => ({ from: () => ({ select: () => ({ eq: async () => ({ count: null, error: { message: "down" } }) }) }) }),
  }));
  const { searchPlaces } = await import("@/lib/onboarding/places");
  await expect(searchPlaces("Ember Grill")).rejects.toThrow(/cap/);
  expect(fetched).toEqual([]);
});
