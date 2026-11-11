// What an App Store / Google Play event from RevenueCat changes, as plain code
// (tests/app-billing.test.ts). The webhook (store-webhook.ts) applies it.
//
// The app logs in to RevenueCat with the restaurant's id as the app user id, so an
// event names its restaurant. A subscription is:
//   trialing   the free month (period_type TRIAL)
//   active     a paid month
//   past_due   a payment failed (BILLING_ISSUE): DinerAI keeps running, as with Stripe
//   expired    it ended (EXPIRATION): the access rule switches the restaurant off
// Cancelling only marks it to end at the end of the month it's in (it runs until then).
// Older events never undo newer ones (store_event_at), as with Stripe.

export type StoreEvent = {
  id: string;
  type: string;
  event_timestamp_ms?: number;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  aliases?: string[] | null;
  product_id?: string | null;
  period_type?: string | null; // TRIAL | INTRO | NORMAL | PROMOTIONAL | PREPAID
  expiration_at_ms?: number | null;
  environment?: string | null; // SANDBOX | PRODUCTION
  store?: string | null; // APP_STORE | PLAY_STORE | ...
  entitlement_ids?: string[] | null;
  price?: number | null;
  offer_code?: string | null;
  cancel_reason?: string | null;
  expiration_reason?: string | null;
};

export type StoreFields = {
  store_status?: string | null;
  store_platform?: string | null;
  store_product_id?: string | null;
  store_period_end?: string | null;
  store_cancel_at_period_end?: boolean | null;
  store_environment?: string | null;
  store_event_at?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The restaurant ids an event could be about, most likely first.
export function restaurantIdsOf(e: Pick<StoreEvent, "app_user_id" | "original_app_user_id" | "aliases">) {
  return [...new Set([e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
}

const platformOf = (store: string | null | undefined) => (store === "APP_STORE" || store === "MAC_APP_STORE" ? "app_store" : store === "PLAY_STORE" ? "play_store" : store ? store.toLowerCase() : null);
const iso = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);

// The events that mean "it's running" (a free month or a paid one).
const RUNNING = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT", "REFUND_REVERSED"]);

export type StoreChange = { fields: StoreFields; note: string } | null;

// What the event changes. null: nothing (a test, an older event, or one about
// something that isn't DinerAI's subscription, e.g. another entitlement).
export function storeChange(e: StoreEvent, current: StoreFields, entitlement: string): StoreChange {
  if (e.type === "TEST") return null;
  const at = iso(e.event_timestamp_ms) ?? new Date().toISOString();
  if (current.store_event_at && at < current.store_event_at) return null;
  if (e.entitlement_ids && e.entitlement_ids.length && !e.entitlement_ids.includes(entitlement)) return null;
  const base: StoreFields = {
    store_event_at: at,
    ...(e.environment ? { store_environment: e.environment } : {}),
    ...(platformOf(e.store) ? { store_platform: platformOf(e.store) } : {}),
    ...(e.product_id ? { store_product_id: e.product_id } : {}),
  };
  const end = iso(e.expiration_at_ms);
  if (RUNNING.has(e.type)) {
    const status = e.period_type === "TRIAL" ? "trialing" : "active";
    return {
      fields: { ...base, store_status: status, ...(end ? { store_period_end: end } : {}), store_cancel_at_period_end: false },
      note: status === "trialing" ? `Free month started in the app (${storeName(e.store)})` : e.type === "RENEWAL" ? `Paid a month in the app (${storeName(e.store)})` : `Subscription running in the app (${storeName(e.store)})`,
    };
  }
  if (e.type === "CANCELLATION") {
    // A refund or a payment that never went through ends it now; otherwise at the month's end.
    return {
      fields: { ...base, store_cancel_at_period_end: true, ...(end ? { store_period_end: end } : {}) },
      note: `Subscription cancelled (${(e.cancel_reason ?? "unsubscribed").toLowerCase().replace(/_/g, " ")}): it runs until ${end ? end.slice(0, 10) : "the end of the month"}`,
    };
  }
  if (e.type === "BILLING_ISSUE") return { fields: { ...base, store_status: "past_due" }, note: `A payment didn't go through (${storeName(e.store)}): DinerAI keeps running meanwhile` };
  if (e.type === "EXPIRATION") return { fields: { ...base, store_status: "expired", store_cancel_at_period_end: false }, note: `Subscription ended (${(e.expiration_reason ?? "expired").toLowerCase().replace(/_/g, " ")})` };
  return null;
}

export const storeName = (store: string | null | undefined) => (store === "PLAY_STORE" ? "Google Play" : store === "APP_STORE" || store === "MAC_APP_STORE" ? "App Store" : (store ?? "the store"));

// A paid month (not the free one, not a test with no price): the recommender's free
// month is due (billing/referrals.ts), the same as Stripe's first paid invoice.
export function isPaidMonth(e: Pick<StoreEvent, "type" | "period_type" | "price">) {
  return (e.type === "RENEWAL" || e.type === "INITIAL_PURCHASE") && e.period_type !== "TRIAL" && (e.price ?? 0) > 0;
}

// The webhook's signature (RevenueCat > Webhooks > HMAC signing): header
// "t=<unix seconds>,v1=<hex>", an HMAC-SHA256 of "<t>.<raw body>" with the signing
// secret. Older than 5 minutes is refused (a replay). Returns the hex to compare.
export const SIGNATURE_TOLERANCE_S = 300;
export function parseSignature(header: string | null): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t") t = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  return Number.isFinite(t) && v1.length ? { t, v1 } : null;
}
