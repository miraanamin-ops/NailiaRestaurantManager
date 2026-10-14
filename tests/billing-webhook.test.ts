// The Stripe webhook: only events signed with our secret get through, each event
// type changes the right things, a repeated event is handled once, an older event
// never undoes a newer one, and the restaurant is switched on or off by the access rule.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Stripe from "stripe";
import { memoryDb } from "./support/memory-db";

const SECRET = "whsec_test_secret";
const R = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400;
const NOW = Math.floor(Date.UTC(2026, 9, 14, 12) / 1000);

const logAction = vi.fn<(entry: { detail?: string }) => Promise<void>>(async () => {});
const alertBuilder = vi.fn<(key: string, message: string) => Promise<string>>(async () => "ok");
let db: ReturnType<typeof memoryDb>;

function seed(restaurant: Record<string, unknown> = {}, onboardingDone = true) {
  db = memoryDb(
    {
      restaurants: [
        {
          id: R,
          name: "Rose & Thyme",
          owner_email: "owner@rose.test",
          active: false,
          billing_exempt: false,
          pilot_invite_code: null,
          stripe_customer_id: null,
          subscription_status: null,
          billing_event_at: null,
          ...restaurant,
        },
      ],
      onboarding: [{ restaurant_id: R, steps: {}, data: {}, completed_at: onboardingDone ? "2026-10-14T10:00:00Z" : null }],
      stripe_events: [],
    },
    { unique: ["stripe_events"] },
  );
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  logAction.mockClear();
  alertBuilder.mockClear();
  seed();
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/audit", () => ({ logAction }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/audit");
  vi.doUnmock("@/lib/builder-alerts");
  vi.resetModules();
});

let n = 0;
function event(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: `evt_${++n}`, object: "event", type, created: NOW, api_version: "2026-08-26.dahlia", data: { object, ...extra }, livemode: false };
}
const subscription = (fields: Record<string, unknown> = {}) => ({
  id: "sub_1",
  object: "subscription",
  customer: "cus_1",
  status: "trialing",
  trial_end: NOW + 14 * DAY,
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: { restaurant_id: R },
  items: { data: [{ current_period_end: NOW + 14 * DAY }] },
  ...fields,
});

async function post(body: unknown, opts: { secret?: string | null } = {}) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret !== null) headers["stripe-signature"] = new Stripe("sk_test_123").webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET });
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(new NextRequest("https://app.test/api/stripe/webhook", { method: "POST", body: payload, headers }));
}
const restaurant = () => db.tables.restaurants[0];

describe("signatures", () => {
  test("an unsigned request is rejected and changes nothing", async () => {
    const res = await post(event("customer.subscription.created", subscription()), { secret: null });
    expect(res.status).toBe(400);
    expect(db.tables.stripe_events).toHaveLength(0);
  });

  test("a request signed with the wrong secret is rejected", async () => {
    const res = await post(event("customer.subscription.created", subscription()), { secret: "whsec_someone_else" });
    expect(res.status).toBe(400);
    expect(db.tables.stripe_events).toHaveLength(0);
    expect(restaurant().subscription_status).toBeNull();
  });

  test("a tampered body fails the signature check", async () => {
    const original = JSON.stringify(event("customer.subscription.created", subscription()));
    const signature = new Stripe("sk_test_123").webhooks.generateTestHeaderString({ payload: original, secret: SECRET });
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const tampered = original.replace('"trialing"', '"active"');
    const res = await POST(new NextRequest("https://app.test/api/stripe/webhook", { method: "POST", body: tampered, headers: { "stripe-signature": signature } }));
    expect(res.status).toBe(400);
  });
});

describe("each event", () => {
  test("checkout.session.completed links the Stripe customer and subscription (found by the restaurant id Stripe carries)", async () => {
    const res = await post(
      event("checkout.session.completed", { id: "cs_test_1", object: "checkout.session", mode: "subscription", status: "complete", customer: "cus_1", subscription: "sub_1", metadata: { restaurant_id: R }, client_reference_id: R }),
    );
    expect(res.status).toBe(200);
    expect(restaurant()).toMatchObject({ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    expect(db.tables.stripe_events[0]).toMatchObject({ type: "checkout.session.completed", restaurant_id: R });
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: R, actor: "stripe", action: "billing" }));
  });

  test("customer.subscription.created (trialing) records the trial and switches a set-up restaurant on", async () => {
    seed({ stripe_customer_id: "cus_1" });
    await post(event("customer.subscription.created", subscription()));
    expect(restaurant()).toMatchObject({
      subscription_status: "trialing",
      stripe_subscription_id: "sub_1",
      trial_ends_at: new Date((NOW + 14 * DAY) * 1000).toISOString(),
      current_period_end: new Date((NOW + 14 * DAY) * 1000).toISOString(),
      active: true,
    });
    expect(logAction.mock.calls.map((c) => c[0].detail)).toContain("Switched on (trialing)");
  });

  test("a trial on a restaurant still setting up doesn't switch it on yet", async () => {
    seed({ stripe_customer_id: "cus_1" }, false);
    await post(event("customer.subscription.created", subscription()));
    expect(restaurant()).toMatchObject({ subscription_status: "trialing", active: false });
  });

  test("customer.subscription.updated: a cancellation at period end is recorded and the builder told, but it keeps running", async () => {
    seed({ stripe_customer_id: "cus_1", subscription_status: "active", active: true });
    await post(
      event("customer.subscription.updated", subscription({ status: "active", cancel_at_period_end: true, trial_end: null }), { previous_attributes: { cancel_at_period_end: false } }),
    );
    expect(restaurant()).toMatchObject({ subscription_status: "active", cancel_at_period_end: true, active: true });
    expect(alertBuilder).toHaveBeenCalledWith(expect.stringContaining("customer.subscription.updated"), expect.stringContaining("Owner cancelled"));
  });

  test("customer.subscription.updated back to active clears a failed payment", async () => {
    seed({ stripe_customer_id: "cus_1", subscription_status: "past_due", payment_failed_at: "2026-10-13T09:00:00Z", active: true });
    await post(event("customer.subscription.updated", subscription({ status: "active", trial_end: null })));
    expect(restaurant()).toMatchObject({ subscription_status: "active", payment_failed_at: null, active: true });
  });

  test("customer.subscription.deleted switches the restaurant off and keeps its data", async () => {
    seed({ stripe_customer_id: "cus_1", subscription_status: "active", active: true });
    await post(event("customer.subscription.deleted", subscription({ status: "canceled" })));
    expect(restaurant()).toMatchObject({ subscription_status: "canceled", active: false, name: "Rose & Thyme" });
    expect(alertBuilder).toHaveBeenCalledWith(`billing:off:${R}`, expect.stringContaining("switched off"));
  });

  test("invoice.payment_failed alerts the builder (never the owner) and doesn't cut the owner off", async () => {
    seed({ stripe_customer_id: "cus_1", subscription_status: "past_due", active: true });
    await post(event("invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_1", amount_due: 9900, attempt_count: 1 }));
    expect(restaurant()).toMatchObject({ payment_failed_at: new Date(NOW * 1000).toISOString(), active: true });
    expect(alertBuilder).toHaveBeenCalledWith(expect.stringContaining("invoice.payment_failed"), expect.stringContaining("Payment failed: £99.00"));
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ detail: "Payment failed (£99.00, attempt 1)" }));
  });

  test("an event type we don't use is acknowledged and changes nothing", async () => {
    seed({ stripe_customer_id: "cus_1" });
    const res = await post(event("customer.updated", { id: "cus_1", object: "customer", customer: "cus_1" }));
    expect(await res.json()).toMatchObject({ result: "ignored" });
    expect(logAction).not.toHaveBeenCalled();
  });

  test("an event for a customer no restaurant has alerts the builder", async () => {
    const res = await post(event("customer.subscription.created", subscription({ customer: "cus_nobody", metadata: {} })));
    expect(await res.json()).toMatchObject({ result: "unknown_restaurant" });
    expect(restaurant().subscription_status).toBeNull();
    expect(alertBuilder).toHaveBeenCalled();
  });

  test("never moves a restaurant to a different Stripe customer", async () => {
    seed({ stripe_customer_id: "cus_1" });
    await post(event("customer.subscription.created", subscription({ customer: "cus_other" })));
    expect(restaurant()).toMatchObject({ stripe_customer_id: "cus_1", subscription_status: null });
  });
});

describe("repeats and order", () => {
  test("the same event delivered twice is handled once", async () => {
    seed({ stripe_customer_id: "cus_1" });
    const e = event("customer.subscription.created", subscription());
    const first = await post(e);
    const second = await post(e);
    expect(await first.json()).toMatchObject({ result: "applied" });
    expect(await second.json()).toMatchObject({ result: "duplicate" });
    expect(db.tables.stripe_events).toHaveLength(1);
    expect(logAction.mock.calls.filter((c) => String(c[0].detail).startsWith("Subscription started"))).toHaveLength(1);
  });

  test("an older event arriving late doesn't undo a newer one", async () => {
    seed({ stripe_customer_id: "cus_1", subscription_status: "canceled", billing_event_at: new Date((NOW + 60) * 1000).toISOString() });
    await post(event("customer.subscription.updated", subscription({ status: "active" })));
    expect(restaurant().subscription_status).toBe("canceled");
  });

  test("if handling fails, Stripe gets a 500 and the event isn't marked done, so its retry works", async () => {
    seed({ stripe_customer_id: "cus_1" });
    logAction.mockRejectedValueOnce(new Error("database down"));
    const e = event("customer.subscription.created", subscription());
    expect((await post(e)).status).toBe(500);
    expect(db.tables.stripe_events).toHaveLength(0);
    const retry = await post(e);
    expect(await retry.json()).toMatchObject({ result: "applied" });
  });
});
