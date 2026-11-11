// Paying in the app (step 50, phase 4): App Store / Google Play subscriptions from
// RevenueCat feed the same access rule as Stripe. The event rules, the signature,
// the webhook (each event once, older events never undo newer ones, the free month
// opens setup, a paid month credits the recommender), the access rule with either
// kind of payment, and FOUNDER on Android.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { billingNotice, billingStanding, paysThroughStore } from "@/lib/billing/access";
import { isPaidMonth, parseSignature, restaurantIdsOf, storeChange, type StoreEvent } from "@/lib/billing/store-events";
import { appStage } from "@/lib/app/stage";
import { memoryDb } from "./support/memory-db";

const R = "a0000000-0000-4000-8000-00000000000a";
const T0 = Date.parse("2026-11-12T10:00:00Z");
const ev = (over: Partial<StoreEvent>): StoreEvent => ({
  id: `evt-${Math.random()}`,
  type: "INITIAL_PURCHASE",
  event_timestamp_ms: T0,
  app_user_id: R,
  original_app_user_id: R,
  aliases: [R],
  product_id: "dinerai_monthly",
  period_type: "TRIAL",
  expiration_at_ms: T0 + 30 * 86_400_000,
  environment: "PRODUCTION",
  store: "APP_STORE",
  entitlement_ids: ["dinerai"],
  ...over,
});

describe("store event rules", () => {
  test("the free month, a paid month, a cancel, a failed payment and the end", () => {
    expect(storeChange(ev({}), {}, "dinerai")).toMatchObject({ fields: { store_status: "trialing", store_platform: "app_store", store_cancel_at_period_end: false, store_period_end: "2026-12-12T10:00:00.000Z" }, note: expect.stringMatching(/Free month started.*App Store/) });
    expect(storeChange(ev({ type: "RENEWAL", period_type: "NORMAL", store: "PLAY_STORE" }), {}, "dinerai")?.fields).toMatchObject({ store_status: "active", store_platform: "play_store" });
    expect(storeChange(ev({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" }), {}, "dinerai")).toMatchObject({ fields: { store_cancel_at_period_end: true }, note: expect.stringMatching(/runs until 2026-12-12/) });
    expect(storeChange(ev({ type: "CANCELLATION" }), {}, "dinerai")?.fields.store_status).toBeUndefined(); // it keeps running until then
    expect(storeChange(ev({ type: "BILLING_ISSUE" }), {}, "dinerai")?.fields.store_status).toBe("past_due");
    expect(storeChange(ev({ type: "EXPIRATION" }), {}, "dinerai")?.fields.store_status).toBe("expired");
  });

  test("nothing changes for a test event, an older event, or another entitlement", () => {
    expect(storeChange(ev({ type: "TEST" }), {}, "dinerai")).toBeNull();
    expect(storeChange(ev({ event_timestamp_ms: T0 - 1000 }), { store_event_at: new Date(T0).toISOString() }, "dinerai")).toBeNull();
    expect(storeChange(ev({ entitlement_ids: ["something_else"] }), {}, "dinerai")).toBeNull();
    expect(storeChange(ev({ type: "SUBSCRIPTION_PAUSED" }), {}, "dinerai")).toBeNull();
  });

  test("which restaurant: only real ids, from the app user id and its aliases", () => {
    expect(restaurantIdsOf({ app_user_id: "$RCAnonymousID:abc", original_app_user_id: R.toUpperCase(), aliases: ["$RCAnonymousID:abc", R] })).toEqual([R]);
    expect(restaurantIdsOf({ app_user_id: "nope" })).toEqual([]);
  });

  test("a paid month credits the recommender; the free month doesn't", () => {
    expect(isPaidMonth({ type: "RENEWAL", period_type: "NORMAL", price: 99 })).toBe(true);
    expect(isPaidMonth({ type: "INITIAL_PURCHASE", period_type: "TRIAL", price: 0 })).toBe(false);
    expect(isPaidMonth({ type: "RENEWAL", period_type: "NORMAL", price: 0 })).toBe(false);
  });

  test("the signature header", () => {
    expect(parseSignature("t=1700000000,v1=abc,v1=def")).toEqual({ t: 1700000000, v1: ["abc", "def"] });
    expect(parseSignature("v1=abc")).toBeNull();
    expect(parseSignature(null)).toBeNull();
  });
});

describe("the access rule, paid either way", () => {
  test("a store subscription counts like Stripe's", () => {
    expect(billingStanding({ store_status: "trialing" })).toEqual({ ok: true, standing: "trialing" });
    expect(billingStanding({ store_status: "past_due" })).toEqual({ ok: true, standing: "past_due" });
    expect(billingStanding({ store_status: "expired" })).toEqual({ ok: false, standing: "ended" });
    expect(billingStanding({ subscription_status: "canceled", store_status: "active" })).toEqual({ ok: true, standing: "active" });
    expect(billingStanding({ subscription_status: "active", store_status: "expired" })).toEqual({ ok: true, standing: "active" });
  });

  test("settings speaks of the store, not Manage billing, for store payers", () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    expect(paysThroughStore({ store_status: "trialing" })).toBe(true);
    expect(paysThroughStore({ store_status: "trialing", subscription_status: "active" })).toBe(false);
    expect(billingNotice({ store_status: "past_due" }, fmt)?.text).toMatch(/App Store or Google Play/);
    expect(billingNotice({ store_status: "trialing", store_period_end: "2026-12-12T10:00:00Z" }, fmt)?.text).toMatch(/Free month until 2026-12-12/);
    expect(billingNotice({ subscription_status: "past_due" }, fmt)?.text).toMatch(/Manage billing/);
  });

  test("where the app sends the owner: pay, setup or the tabs", () => {
    expect(appStage({}, false)).toBe("pay");
    expect(appStage({ pilot_invite_code: "PILOT" }, false)).toBe("setup");
    expect(appStage({ store_status: "trialing" }, false)).toBe("setup");
    expect(appStage({ store_status: "active" }, true)).toBe("ready");
    expect(appStage({ store_status: "expired" }, true)).toBe("pay");
    expect(appStage({ billing_exempt: true }, true)).toBe("ready");
  });
});

// ---------- The webhook ----------

const SECRET = "whsec-test-0123456789";
let mem: ReturnType<typeof memoryDb>;
let alerts: string[];
const started: string[] = [];
const synced: string[] = [];
const credited: string[] = [];

function sign(body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
const post = (event: StoreEvent | object, header?: string | null) => {
  const body = JSON.stringify({ api_version: "1.0", event });
  return new NextRequest("https://app.test/api/revenuecat/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...(header === null ? {} : { "x-revenuecat-webhook-signature": header ?? sign(body) }) } });
};

beforeEach(() => {
  vi.resetModules();
  process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
  mem = memoryDb({ restaurants: [{ id: R, name: "Rose & Thyme", is_demo: false, store_status: null, referred_by: "b0000000-0000-4000-8000-00000000000b" }], revenuecat_events: [] }, { unique: ["revenuecat_events"] });
  alerts = [];
  started.length = synced.length = credited.length = 0;
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => mem.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
  vi.doMock("@/lib/onboarding/sessions", () => ({ startOnboarding: async (id: string) => void started.push(id) }));
  vi.doMock("@/lib/billing/activation", () => ({ syncActive: async (id: string) => (synced.push(id), true) }));
  vi.doMock("@/lib/billing/referrals", () => ({ creditReferralIfDue: async (r: { id: string }) => (credited.push(r.id), "credited") }));
});
afterEach(() => {
  delete process.env.REVENUECAT_WEBHOOK_SECRET;
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/onboarding/sessions", "@/lib/billing/activation", "@/lib/billing/referrals", "@/lib/auth"]) vi.doUnmock(m);
});

const restaurant = () => mem.tables.restaurants[0] as Record<string, unknown>;

describe("the RevenueCat webhook", () => {
  test("only signed, recent events are accepted", async () => {
    const { POST } = await import("@/app/api/revenuecat/webhook/route");
    expect((await POST(post(ev({}), null))).status).toBe(400);
    expect((await POST(post(ev({}), "t=1,v1=00"))).status).toBe(400);
    const old = Math.floor(Date.now() / 1000) - 600;
    const body = JSON.stringify({ api_version: "1.0", event: ev({}) });
    expect((await POST(post(ev({}), sign(body, old)))).status).toBe(400); // a replay
    expect((await POST(post(ev({}), sign("x", undefined, "wrong-secret")))).status).toBe(400);
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    expect((await POST(post(ev({})))).status).toBe(503);
    expect(restaurant().store_status).toBeNull();
  });

  test("the free month starts: saved, setup opens, the access rule runs; the same event again does nothing", async () => {
    const { POST } = await import("@/app/api/revenuecat/webhook/route");
    const e = ev({ id: "evt-1" });
    const res = await POST(post(e));
    expect(await res.json()).toEqual({ received: true, result: "applied" });
    expect(restaurant()).toMatchObject({ store_status: "trialing", store_platform: "app_store", store_environment: "PRODUCTION" });
    expect(started).toEqual([R]);
    expect(synced).toEqual([R]);
    expect(await (await POST(post(e))).json()).toEqual({ received: true, result: "duplicate" });
    expect(synced).toEqual([R]);
    expect(credited).toEqual([]); // the free month earns the recommender nothing
  });

  test("a paid month credits the recommender; the end switches it off through the access rule", async () => {
    const { POST } = await import("@/app/api/revenuecat/webhook/route");
    await POST(post(ev({ id: "e1" })));
    await POST(post(ev({ id: "e2", type: "RENEWAL", period_type: "NORMAL", price: 99, event_timestamp_ms: T0 + 31 * 86_400_000 })));
    expect(restaurant().store_status).toBe("active");
    expect(credited).toEqual([R]);
    await POST(post(ev({ id: "e3", type: "EXPIRATION", event_timestamp_ms: T0 + 62 * 86_400_000 })));
    expect(restaurant().store_status).toBe("expired");
    // A late, older event never brings it back.
    await POST(post(ev({ id: "e0", type: "RENEWAL", period_type: "NORMAL", event_timestamp_ms: T0 + 40 * 86_400_000 })));
    expect(restaurant().store_status).toBe("expired");
  });

  test("an unknown app user, and a test purchase on a real restaurant, are told to the builder", async () => {
    const { POST } = await import("@/app/api/revenuecat/webhook/route");
    expect(await (await POST(post(ev({ id: "u1", app_user_id: "$RCAnonymousID:x", original_app_user_id: "$RCAnonymousID:x", aliases: [] })))).json()).toMatchObject({ result: "unknown_restaurant" });
    await POST(post(ev({ id: "s1", environment: "SANDBOX" })));
    expect(restaurant().store_environment).toBe("SANDBOX");
    expect(alerts.join("\n")).toMatch(/no restaurant has[\s\S]*test \(sandbox\) App Store purchase/);
  });

  test("a failure gives the event back, so RevenueCat's retry works", async () => {
    vi.doMock("@/lib/billing/activation", () => ({ syncActive: async () => { throw new Error("db down"); } }));
    const { POST } = await import("@/app/api/revenuecat/webhook/route");
    expect((await POST(post(ev({ id: "f1" })))).status).toBe(500);
    expect(mem.tables.revenuecat_events).toEqual([]);
  });
});

describe("FOUNDER on Android", () => {
  const token = "access-token-123456";
  beforeEach(() => {
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), ownerFromToken: async (t: string) => (t === token ? { email: "sam@rose.test", isBuilder: false, restaurantIds: [R], allowed: true } : null) }));
    mem.tables.founder_claims = [];
  });
  const req = (body: object) => new NextRequest("https://app.test/api/app/billing/founder", { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });

  test("the right code takes one of the 50 places, once; a wrong code, a paid restaurant or no places left are refused", async () => {
    const { POST } = await import("@/app/api/app/billing/founder/route");
    expect(await (await POST(req({ r: R, code: "nope" }))).json()).toMatchObject({ ok: false });
    expect(await (await POST(req({ r: R, code: " founder " }))).json()).toEqual({ ok: true, offer: "founder" });
    expect(await (await POST(req({ r: R, code: "FOUNDER" }))).json()).toEqual({ ok: true, offer: "founder" });
    expect(mem.tables.founder_claims).toHaveLength(1);

    mem.tables.founder_claims = Array.from({ length: 50 }, (_, i) => ({ restaurant_id: `other-${i}`, platform: "play_store" }));
    expect(await (await POST(req({ r: R, code: "FOUNDER" }))).json()).toMatchObject({ ok: false, reason: expect.stringMatching(/all 50/) });
    mem.tables.founder_claims = [];
    restaurant().store_status = "active";
    expect(await (await POST(req({ r: R, code: "FOUNDER" }))).json()).toMatchObject({ ok: false, reason: expect.stringMatching(/new restaurants/) });
    expect((await POST(req({ r: "b0000000-0000-4000-8000-00000000000b", code: "FOUNDER" }))).status).toBe(404);
  });
});
