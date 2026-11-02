// Hello's Google Maps pre-fill with the REAL Google Places and Claude, on the
// in-memory database: a new restaurant with no address yet. Dina should offer
// the match ("Is this you?") instead of asking them to type the address. Needs
// GOOGLE_PLACES_API_KEY. Costs about 2p (one Places search, one Claude turn). Run:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-hello-places.e2e.ts
import { beforeAll, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000e6";
let db: ReturnType<typeof memoryDb>;

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.GOOGLE_PLACES_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY and GOOGLE_PLACES_API_KEY (run with --env-file=.env.local)");
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Dishoom Shoreditch", owner_name: "Amina Khan", address: null, cuisine: null, phone: null, website: null, menu: [], profile_version: 0, active: false }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "hello", channel_last_used: "web", started_at: new Date().toISOString(), completed_at: null }],
      onboarding_steps: [],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      google_connections: [],
      rate_limits: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
});

describe("Hello with Google Maps, for real", () => {
  test("no address yet: Dina offers the match instead of asking them to type it", async () => {
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    const out = await dinaTurn({ restaurantId: R, channel: "web", event: "start" });
    if (out.duplicate) throw new Error("duplicate");
    console.log(`\n--- start  ($${out.costUsd.toFixed(4)})`);
    for (const m of out.messages) console.log(`Dina: ${m.text}${m.component ? `  [${JSON.stringify(m.component)}]` : ""}`);
    const places = db.tables.onboarding_steps.find((s) => s.step_key === "hello")?.data.places;
    console.log("\n[Google Maps matches kept on the step]", JSON.stringify(places));
    expect(out.fallback).toBe(false);
    expect(places?.length).toBeGreaterThan(0);
    expect(out.messages.map((m) => m.text).join(" ")).toMatch(/Boundary St/);
    expect(db.tables.rate_limits).toHaveLength(1); // one Places call, counted against the daily cap
  });
});
