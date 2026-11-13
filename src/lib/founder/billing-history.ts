import "server-only";
import { billingStanding, type BillingFields } from "@/lib/billing/access";
import { getSupabase } from "@/lib/supabase";

// billing_history (supabase/070): one line each time a restaurant's billing
// standing changes, and one per payment. Written by the Stripe and RevenueCat
// webhooks and by account closing; the founder dashboard counts churn, conversion,
// retention and revenue from it (lib/founder/metrics.ts). Never throws: the
// webhook's real work must not fail because a history line couldn't be saved.

export type HistorySource = "stripe" | "app_store" | "play_store" | "closure" | "backfill" | "system";

const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";

async function insert(row: Record<string, unknown>) {
  try {
    const { error } = await getSupabase().from("billing_history").insert(row);
    // 23505: this payment (external_id) is already recorded.
    if (error && error.code !== "23505" && !missingTable(error.code)) console.error("Couldn't record billing history", error.message);
  } catch (err) {
    console.error("Couldn't record billing history", err);
  }
}

// A line if the standing (trialing, active, ended...) is different after the change.
export async function recordStandingChange(input: {
  restaurantId: string;
  before: BillingFields;
  after: BillingFields;
  source: HistorySource;
  at: string;
  detail?: string | null;
  cancelReason?: string | null;
  externalId?: string | null;
}) {
  const was = billingStanding(input.before).standing;
  const now = billingStanding(input.after).standing;
  if (was === now && !input.cancelReason) return;
  await insert({
    restaurant_id: input.restaurantId,
    at: input.at,
    source: input.source,
    kind: "standing",
    standing: now,
    cancel_reason: input.cancelReason ?? null,
    detail: input.detail ?? null,
    external_id: input.externalId ? `${input.externalId}:standing` : null,
  });
}

export async function recordPayment(input: {
  restaurantId: string;
  source: HistorySource;
  at: string;
  amountPence: number;
  taxPence?: number | null;
  discountPence?: number | null;
  storeFeePence?: number | null;
  currency?: string | null;
  externalId: string;
  detail?: string | null;
}) {
  if (!(input.amountPence > 0)) return;
  await insert({
    restaurant_id: input.restaurantId,
    at: input.at,
    source: input.source,
    kind: "payment",
    amount_pence: Math.round(input.amountPence),
    tax_pence: input.taxPence ?? null,
    discount_pence: input.discountPence ?? null,
    store_fee_pence: input.storeFeePence ?? null,
    currency: input.currency ?? "gbp",
    external_id: input.externalId,
    detail: input.detail ?? null,
  });
}

// The account was closed (lib/closure.ts), just before the restaurant row goes.
export async function recordClosed(restaurantId: string, ref: string) {
  await insert({ restaurant_id: restaurantId, at: new Date().toISOString(), source: "closure", kind: "standing", standing: "closed", detail: `Account closed (${ref})`, external_id: `closure:${ref}` });
}
