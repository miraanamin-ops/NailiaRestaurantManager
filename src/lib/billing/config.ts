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

// The terms an owner ticks at sign-up (the "Last updated" date on /terms), and the
// privacy notice and data processing agreement ticked with them (/privacy, /dpa).
export const TERMS_VERSION = "10 October 2026";
export const PRIVACY_VERSION = "10 October 2026";
export const DPA_VERSION = "28 October 2026";

// Does onboarding wait for payment? Off (the default) while the whole flow is
// being tested: every sign-up needs an invite code, Stripe is never opened, and
// sign-up goes straight into onboarding. TODO(stripe): "true" brings back the
// free trial, and startOnboarding (lib/onboarding/sessions.ts) moves to the
// Stripe webhook, after the trial starts.
export function onboardingRequiresPayment(env: Record<string, string | undefined> = process.env) {
  return env.ONBOARDING_REQUIRES_PAYMENT === "true";
}

// Tags our Checkout sessions in Stripe's dashboard.
export const CHECKOUT_TAG = "dinerai_trial_qkzmwpre";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

// Can someone sign up and pay without an invite code? Needs payment switched on
// (ONBOARDING_REQUIRES_PAYMENT), Stripe set up, and on the live site also
// PUBLIC_SIGNUP=true. Previews and local copies don't need PUBLIC_SIGNUP.
export function publicSignupOpen(env: Record<string, string | undefined> = process.env) {
  if (!onboardingRequiresPayment(env)) return false;
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) return false;
  return env.VERCEL_ENV !== "production" || env.PUBLIC_SIGNUP === "true";
}
