// Owner referrals (step 47) and the paid trial (one calendar month, FOUNDER on
// Stripe's page): codes are tidy and stable, nobody refers themselves, and a
// recommended restaurant's first real payment gives its recommender one £99
// credit, once, through the signed Stripe webhook.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Stripe from "stripe";
import { memoryDb } from "./support/memory-db";
import { canRefer, cleanReferralCode, earnsReferralCredit, referralCodeFor } from "@/lib/billing/referrals-rules";
import { FOUNDER, trialDays, trialEnd } from "@/lib/billing/config";
import { keyAllowed } from "@/lib/billing/stripe";

describe("referral codes", () => {
  test("first word of the name and 4 characters from the id, stable and readable", () => {
    const a = referralCodeFor("Ember & Spice Grill", "11111111-1111-4111-8111-111111111111");
    expect(a).toMatch(/^EMBER-[A-HJ-NP-Z2-9]{4}$/);
    expect(referralCodeFor("Ember & Spice Grill", "11111111-1111-4111-8111-111111111111")).toBe(a);
    expect(referralCodeFor("Ember & Spice Grill", "11111111-1111-4111-8111-111111111111", 1)).not.toBe(a);
    expect(referralCodeFor("The Cardamom Corner Café", "x")).toMatch(/^CARDAMOM-/);
    expect(referralCodeFor("123", "x")).toMatch(/^DINER-/);
  });
  test("typed codes are tidied; nonsense isn't a code", () => {
    expect(cleanReferralCode(" ember-7k2q ")).toBe("EMBER-7K2Q");
    expect(cleanReferralCode("EMBER_7K2Q")).toBe("EMBER-7K2Q");
    expect(cleanReferralCode("PILOT-ZERO-RERUN")).toBeNull();
    expect(cleanReferralCode("")).toBeNull();
  });
  test("nobody recommends themselves", () => {
    const referrer = { id: "a", owner_email: "Sam@Ember.test" };
    expect(canRefer(referrer, { email: "sam@ember.test" })).toBe(false);
    expect(canRefer(referrer, { id: "a", email: "other@x.test" })).toBe(false);
    expect(canRefer(referrer, { email: "jo@cafe.test" })).toBe(true);
  });
  test("only a real payment by a recommended restaurant earns the credit, once", () => {
    const r = { referred_by: "a", referral_credited_at: null };
    expect(earnsReferralCredit({ amount_paid: 9900, status: "paid" }, r)).toBe(true);
    expect(earnsReferralCredit({ amount_paid: 0, status: "paid" }, r)).toBe(false); // the free month
    expect(earnsReferralCredit({ amount_paid: 5000, status: "paid" }, { referred_by: null })).toBe(false);
    expect(earnsReferralCredit({ amount_paid: 5000, status: "paid" }, { ...r, referral_credited_at: "2026-12-01" })).toBe(false);
  });
});

describe("the free month and keys", () => {
  test("the trial ends on the same date next month (shorter months clamp)", () => {
    expect(trialEnd(new Date("2026-11-08T21:00:00Z"), {})?.toISOString()).toBe("2026-12-08T21:00:00.000Z");
    expect(trialEnd(new Date("2027-01-31T10:00:00Z"), {})?.toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(trialEnd(new Date("2026-12-15T10:00:00Z"), {})?.toISOString()).toBe("2027-01-15T10:00:00.000Z");
  });
  test("TRIAL_DAYS only for testing (at least 3 days: Stripe needs 48 hours)", () => {
    expect(trialDays({})).toBeNull();
    expect(trialEnd(new Date("2026-11-08T00:00:00Z"), { TRIAL_DAYS: "1" })?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(trialEnd(new Date("2026-11-08T00:00:00Z"), { TRIAL_DAYS: "0" })).toBeNull();
  });
  test("FOUNDER: £49 off for 4 months (free month + months 2 to 4 at £50), 50 uses", () => {
    expect(FOUNDER).toEqual({ code: "FOUNDER", amountOffPence: 4900, months: 4, maxUses: 50 });
  });
  test("live Stripe keys only on the live site", () => {
    expect(keyAllowed("sk_test_x", {})).toBe(true);
    expect(keyAllowed("rk_live_x", {})).toBe(false);
    expect(keyAllowed("rk_live_x", { VERCEL_ENV: "preview" })).toBe(false);
    expect(keyAllowed("rk_live_x", { VERCEL_ENV: "production" })).toBe(true);
  });
});

// ---------- Through the webhook ----------

const SECRET = "whsec_test_secret";
const REFERRER = "aaaaaaaa-1111-4111-8111-111111111111";
const NEW = "bbbbbbbb-2222-4222-8222-222222222222";
let db: ReturnType<typeof memoryDb>;
const balance = vi.fn(async () => ({ id: "cbtxn_1" }));
const logAction = vi.fn(async () => {});
const alertBuilder = vi.fn(async () => "ok");
const told: string[] = [];

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  balance.mockClear();
  told.length = 0;
  db = memoryDb(
    {
      restaurants: [
        { id: REFERRER, name: "Ember & Spice", owner_email: "sam@ember.test", active: true, stripe_customer_id: "cus_ref", subscription_status: "active", referral_code: "EMBER-7K2Q", owner_whatsapp: "whatsapp:+447700900111", whatsapp_from: "whatsapp:+447403690497" },
        { id: NEW, name: "Rose & Thyme", owner_email: "jo@rose.test", active: true, stripe_customer_id: "cus_new", subscription_status: "active", referred_by: REFERRER, referral_credited_at: null },
      ],
      onboarding: [{ restaurant_id: NEW, steps: {}, data: {}, completed_at: "2026-10-14T10:00:00Z" }],
      stripe_events: [],
    },
    { unique: ["stripe_events"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/audit", () => ({ logAction }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void told.push(text) }));
  vi.doMock("@/lib/billing/stripe", async (orig) => {
    const real = await orig<typeof import("@/lib/billing/stripe")>();
    const s = new Stripe("sk_test_123");
    (s.customers as unknown as { createBalanceTransaction: typeof balance }).createBalanceTransaction = balance;
    return { ...real, getStripe: () => s };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/audit", "@/lib/builder-alerts", "@/lib/notify", "@/lib/billing/stripe"]) vi.doUnmock(m);
  vi.resetModules();
});

let n = 0;
async function paid(amount: number) {
  const body = JSON.stringify({
    id: `evt_ref_${++n}`,
    object: "event",
    type: "invoice.paid",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `in_${n}`, object: "invoice", customer: "cus_new", amount_paid: amount, status: "paid" } },
    livemode: false,
  });
  const headers = { "content-type": "application/json", "stripe-signature": new Stripe("sk_test_123").webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) };
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(new NextRequest("https://app.test/api/stripe/webhook", { method: "POST", body, headers }));
}

describe("the referral credit", () => {
  test("the free month's £0 invoice earns nothing", async () => {
    expect((await paid(0)).status).toBe(200);
    expect(balance).not.toHaveBeenCalled();
  });

  test("the first real payment credits the recommender £99 once, and tells them", async () => {
    expect((await paid(5000)).status).toBe(200);
    expect(balance).toHaveBeenCalledTimes(1);
    expect(balance).toHaveBeenCalledWith("cus_ref", expect.objectContaining({ amount: -9900, currency: "gbp" }), { idempotencyKey: `referral-credit-${NEW}` });
    expect(db.tables.restaurants[1].referral_credited_at).toBeTruthy();
    expect(told[0]).toContain("Rose & Thyme");
    await paid(9900); // next month: nothing more
    expect(balance).toHaveBeenCalledTimes(1);
  });

  test("a recommender without Stripe billing: the builder is told to credit by hand", async () => {
    db.tables.restaurants[0].stripe_customer_id = null;
    await paid(9900);
    expect(balance).not.toHaveBeenCalled();
    expect(alertBuilder).toHaveBeenCalledWith(`referral:${NEW}`, expect.stringContaining("by hand"));
  });

  test("if Stripe fails, the claim is undone so Stripe's retry can credit it", async () => {
    balance.mockRejectedValueOnce(new Error("Stripe down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await paid(9900)).status).toBe(500);
    expect(db.tables.restaurants[1].referral_credited_at).toBeNull();
  });
});
