// Billing settings in one place. The landing page, /start and Stripe Checkout
// all read these, so the trial length and price can never disagree.
//
// Environment variables:
//   STRIPE_SECRET_KEY      a TEST key (sk_test_... or, better, a restricted rk_test_...). Live keys are refused.
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint in Stripe
//   STRIPE_PRICE_ID        price_... the £99 a month price
//   TRIAL_DAYS             free trial length (default 14)
//   PUBLIC_SIGNUP          "true" opens paid sign-up on the live site; until then it's invite-only there

// The monthly price shown on the site. Stripe charges whatever STRIPE_PRICE_ID says,
// so keep the two the same.
export const PRICE_GBP = 99;

// The free trial length (TRIAL_DAYS, default 14).
export const DEFAULT_TRIAL_DAYS = 14;

export function trialDays() {
  const n = Number(process.env.TRIAL_DAYS);
  return process.env.TRIAL_DAYS && Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_TRIAL_DAYS;
}

// The terms an owner ticks at sign-up (the "Last updated" date on /terms).
export const TERMS_VERSION = "10 October 2026";

// Tags our Checkout sessions in Stripe's dashboard.
export const CHECKOUT_TAG = "dinerai_trial_qkzmwpre";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

// Can someone sign up and pay without an invite code? Needs Stripe set up, and on
// the live site also PUBLIC_SIGNUP=true. Previews and local copies only need Stripe.
export function publicSignupOpen(env: Record<string, string | undefined> = process.env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) return false;
  return env.VERCEL_ENV !== "production" || env.PUBLIC_SIGNUP === "true";
}
