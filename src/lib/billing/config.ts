// Billing settings in one place. The landing page, /start and Stripe Checkout
// all read these, so the trial length and price can never disagree.
//
// Environment variables:
//   STRIPE_SECRET_KEY      a restricted key (rk_...) is best. Live keys only work on the live site
//                          (VERCEL_ENV=production); previews and local copies refuse them.
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint in Stripe
//   STRIPE_PRICE_ID        price_... the £99 a month price (VAT included; scripts/stripe-setup.mjs makes it)
//   TRIAL_DAYS             only for testing: a trial of this many days instead of one calendar month
//   PUBLIC_SIGNUP          "true" opens paid sign-up on the live site; until then it's invite-only there

// The monthly price shown on the site. Stripe charges whatever STRIPE_PRICE_ID says,
// so keep the two the same.
export const PRICE_GBP = 99;

// The free trial: one calendar month (the owner's call, 8 Nov 2026: a full month
// of value before the first charge). TRIAL_DAYS overrides it, for testing only.
export const TRIAL_TEXT = "first month free";

export function trialDays(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.TRIAL_DAYS);
  return env.TRIAL_DAYS && Number.isInteger(n) && n >= 0 && n <= 90 ? n : null;
}

// When the free trial ends: the same date next month (31 Jan -> 28 Feb), same
// time of day. Stripe needs it at least 48 hours away.
export function trialEnd(now: Date, env: Record<string, string | undefined> = process.env) {
  const days = trialDays(env);
  if (days !== null) return days > 0 ? new Date(now.getTime() + Math.max(days, 3) * 86_400_000) : null;
  const end = new Date(now);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}

// The founder offer (scripts/stripe-setup.mjs makes it in Stripe): the free month,
// then the first three paid months at £50. Stripe counts a coupon's months from
// the day it's applied, free month included, so it lasts 4 months. 50 uses.
export const FOUNDER = { code: "FOUNDER", amountOffPence: 4900, months: 4, maxUses: 50 };

// The terms an owner ticks at sign-up (the "Last updated" date on /terms), and the
// privacy notice and data processing agreement ticked with them (/privacy, /dpa).
export const TERMS_VERSION = "7 November 2026";
export const PRIVACY_VERSION = "7 November 2026";
export const DPA_VERSION = "7 November 2026";

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
