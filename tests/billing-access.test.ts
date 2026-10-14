// The access rule: a restaurant runs only when onboarding is finished AND it is
// exempt, on a pilot code, or trialing/active in Stripe. A failed payment keeps
// it running; a cancelled or unpaid subscription doesn't.
import { describe, expect, test } from "vitest";
import { billingNotice, billingStanding, shouldBeActive } from "@/lib/billing/access";
import { publicSignupOpen, trialDays } from "@/lib/billing/config";
import { isLiveKey } from "@/lib/billing/stripe";

describe("who may run", () => {
  test.each([
    [{ billing_exempt: true }, true, "exempt"],
    [{ pilot_invite_code: "PILOT-ONE" }, true, "pilot"],
    [{ subscription_status: "trialing" }, true, "trialing"],
    [{ subscription_status: "active" }, true, "active"],
    [{ subscription_status: "past_due" }, true, "past_due"],
    [{ subscription_status: "canceled" }, false, "ended"],
    [{ subscription_status: "unpaid" }, false, "ended"],
    [{ subscription_status: "incomplete" }, false, "ended"],
    [{ subscription_status: "incomplete_expired" }, false, "ended"],
    [{}, false, "none"],
  ])("%o → %s (%s)", (fields, ok, standing) => {
    expect(billingStanding(fields)).toEqual({ ok, standing });
  });

  test("onboarding must be finished as well", () => {
    expect(shouldBeActive(true, { subscription_status: "trialing" })).toBe(true);
    expect(shouldBeActive(false, { subscription_status: "trialing" })).toBe(false);
    expect(shouldBeActive(false, { billing_exempt: true })).toBe(false);
    expect(shouldBeActive(true, {})).toBe(false);
    expect(shouldBeActive(true, { pilot_invite_code: "PILOT-ONE" })).toBe(true);
  });

  test("a pilot code or exemption wins over an ended subscription", () => {
    expect(shouldBeActive(true, { pilot_invite_code: "PILOT-ONE", subscription_status: "canceled" })).toBe(true);
    expect(shouldBeActive(true, { billing_exempt: true, subscription_status: "unpaid" })).toBe(true);
  });
});

describe("the settings banner", () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  test("a failed payment asks for a new card and says it keeps running", () => {
    expect(billingNotice({ subscription_status: "past_due", payment_failed_at: "2026-10-14T00:00:00Z" }, fmt)).toMatchObject({ tone: "warn", text: expect.stringContaining("keeps running") });
  });
  test("an ended subscription, a cancellation and the trial date", () => {
    expect(billingNotice({ subscription_status: "canceled" }, fmt)?.tone).toBe("warn");
    expect(billingNotice({ subscription_status: "active", cancel_at_period_end: true, current_period_end: "2026-11-14T00:00:00Z" }, fmt)?.text).toContain("2026-11-14");
    expect(billingNotice({ subscription_status: "trialing", trial_ends_at: "2026-10-28T00:00:00Z" }, fmt)?.text).toBe("Free trial until 2026-10-28.");
  });
  test("nothing to say for exempt, pilot or a normal paying restaurant", () => {
    expect(billingNotice({ billing_exempt: true }, fmt)).toBeNull();
    expect(billingNotice({ pilot_invite_code: "X" }, fmt)).toBeNull();
    expect(billingNotice({ subscription_status: "active" }, fmt)).toBeNull();
  });
});

describe("configuration", () => {
  const stripe = { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_PRICE_ID: "price_1" };
  test("the live site stays invite-only until PUBLIC_SIGNUP=true, even with Stripe keys", () => {
    expect(publicSignupOpen({ ...stripe, VERCEL_ENV: "production" })).toBe(false);
    expect(publicSignupOpen({ ...stripe, VERCEL_ENV: "production", PUBLIC_SIGNUP: "true" })).toBe(true);
  });
  test("previews and local copies only need Stripe set up", () => {
    expect(publicSignupOpen({ ...stripe, VERCEL_ENV: "preview" })).toBe(true);
    expect(publicSignupOpen({ ...stripe })).toBe(true);
    expect(publicSignupOpen({ VERCEL_ENV: "preview", PUBLIC_SIGNUP: "true" })).toBe(false);
  });
  test("live Stripe keys are refused", () => {
    expect(isLiveKey("sk_live_abc")).toBe(true);
    expect(isLiveKey("rk_live_abc")).toBe(true);
    expect(isLiveKey("sk_test_abc")).toBe(false);
    expect(isLiveKey("rk_test_abc")).toBe(false);
  });
  test("trial length comes from TRIAL_DAYS, 14 by default", () => {
    const before = process.env.TRIAL_DAYS;
    delete process.env.TRIAL_DAYS;
    expect(trialDays()).toBe(14);
    process.env.TRIAL_DAYS = "30";
    expect(trialDays()).toBe(30);
    process.env.TRIAL_DAYS = "nonsense";
    expect(trialDays()).toBe(14);
    if (before === undefined) delete process.env.TRIAL_DAYS;
    else process.env.TRIAL_DAYS = before;
  });
});
