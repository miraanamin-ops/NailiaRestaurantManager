// Billing settings in one place. The landing page, /start and Stripe Checkout
// all read these, so the trial length and price can never disagree.

// The monthly price shown on the site. Stripe charges whatever STRIPE_PRICE_ID says,
// so keep the two the same.
export const PRICE_GBP = 99;

// The free trial length (TRIAL_DAYS, default 14).
export const DEFAULT_TRIAL_DAYS = 14;

export function trialDays() {
  const n = Number(process.env.TRIAL_DAYS);
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_TRIAL_DAYS;
}
