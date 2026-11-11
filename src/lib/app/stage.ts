// Where a restaurant is, for the app (step 50, phase 4), as plain code
// (tests/app-signup.test.ts):
//   pay     not paid (no free month, subscription or invite yet, or it ended): the
//           app shows "Start your free month" (the App Store / Google Play subscription)
//   setup   paid or invited, setup with Dina not finished: the app shows the setup chat
//   ready   the five tabs
import { billingStanding, paysThroughStore, type BillingFields } from "@/lib/billing/access";

export type AppStage = "pay" | "setup" | "ready";

export function appStage(r: BillingFields, setupFinished: boolean): AppStage {
  if (!billingStanding(r).ok) return "pay";
  return setupFinished ? "ready" : "setup";
}

// What the app's More tab says about the subscription.
export type AppBilling = { standing: string; viaStore: boolean; platform: string | null; renewsOrEnds: string | null; cancelled: boolean };
export function appBilling(r: BillingFields & { store_platform?: string | null; trial_ends_at?: string | null }): AppBilling {
  const viaStore = paysThroughStore(r);
  return {
    standing: billingStanding(r).standing,
    viaStore,
    platform: viaStore ? (r.store_platform ?? null) : null,
    renewsOrEnds: viaStore ? (r.store_period_end ?? null) : (r.current_period_end ?? r.trial_ends_at ?? null),
    cancelled: Boolean(viaStore ? r.store_cancel_at_period_end : false),
  };
}
