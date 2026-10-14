// The access rule, as plain code (tests/billing-access.test.ts).
//
// A restaurant is active (scheduled jobs run, drafts are made) only when onboarding
// is finished AND one of:
//   - it's billing-exempt (every restaurant from before billing),
//   - it signed up with a pilot invite code,
//   - its Stripe subscription is trialing or active.
// A failed payment (past_due) keeps it running: the builder is alerted and settings
// shows a banner, but the owner isn't cut off. Cancelled, unpaid or never-finished
// subscriptions don't count.

export type BillingFields = {
  billing_exempt?: boolean | null;
  pilot_invite_code?: string | null;
  subscription_status?: string | null;
  payment_failed_at?: string | null;
  cancel_at_period_end?: boolean | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
};

export type Standing = "exempt" | "pilot" | "trialing" | "active" | "past_due" | "none" | "ended";

const GOOD = new Set(["trialing", "active", "past_due"]);

export function billingStanding(r: BillingFields): { ok: boolean; standing: Standing } {
  if (r.billing_exempt) return { ok: true, standing: "exempt" };
  if (r.pilot_invite_code) return { ok: true, standing: "pilot" };
  const s = r.subscription_status ?? null;
  if (s && GOOD.has(s)) return { ok: true, standing: s as Standing };
  return { ok: false, standing: s ? "ended" : "none" };
}

export function shouldBeActive(onboardingFinished: boolean, r: BillingFields) {
  return onboardingFinished && billingStanding(r).ok;
}

// What the settings page says about billing, if anything needs saying.
export type BillingNotice = { tone: "warn" | "info"; text: string } | null;

export function billingNotice(r: BillingFields, fmt: (iso: string) => string): BillingNotice {
  const { standing } = billingStanding(r);
  if (standing === "past_due") {
    return { tone: "warn", text: "Your last payment didn't go through. Please update your card in Manage billing. DinerAI keeps running in the meantime." };
  }
  if (standing === "ended") return { tone: "warn", text: "Your subscription has ended, so DinerAI is paused. Start it again any time from Manage billing or by signing up again." };
  if (r.cancel_at_period_end && r.current_period_end) return { tone: "info", text: `Your subscription is cancelled and ends on ${fmt(r.current_period_end)}.` };
  if (standing === "trialing" && r.trial_ends_at) return { tone: "info", text: `Free trial until ${fmt(r.trial_ends_at)}.` };
  return null;
}
