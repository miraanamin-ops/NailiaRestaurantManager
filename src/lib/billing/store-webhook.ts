import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { syncActive } from "./activation";
import { APP_ENTITLEMENT } from "./config";
import { recordPayment, recordStandingChange } from "@/lib/founder/billing-history";
import { isPaidMonth, parseSignature, storePayment, restaurantIdsOf, SIGNATURE_TOLERANCE_S, storeChange, storeName, type StoreEvent } from "./store-events";

// One App Store / Google Play event from RevenueCat (app/api/revenuecat/webhook),
// handled like a Stripe event (billing/webhook.ts): its id is stored first so a
// repeat is skipped, and removed again if handling fails so RevenueCat's retry
// gets another go. Then the access rule decides whether the restaurant runs.

export type StoreWebhookResult = "applied" | "duplicate" | "ignored" | "unknown_restaurant";

// True if the body was signed with our secret in the last 5 minutes.
export function signatureValid(rawBody: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  const sig = parseSignature(header);
  if (!sig || Math.abs(nowS - sig.t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${sig.t}.${rawBody}`).digest();
  return sig.v1.some((hex) => {
    const given = Buffer.from(hex, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function handleStoreEvent(event: StoreEvent): Promise<StoreWebhookResult> {
  const db = getSupabase();
  const claimed = await db.from("revenuecat_events").insert({ id: event.id, type: event.type });
  if (claimed.error) {
    if (claimed.error.code === "23505") return "duplicate";
    throw new Error(claimed.error.message);
  }
  try {
    return await apply(event);
  } catch (err) {
    await db.from("revenuecat_events").delete().eq("id", event.id);
    throw err;
  }
}

async function apply(event: StoreEvent): Promise<StoreWebhookResult> {
  if (event.type === "TEST") return "ignored";
  const db = getSupabase();
  const ids = restaurantIdsOf(event);
  const rows = ids.length ? (check(await db.from("restaurants").select("*").in("id", ids).returns<Restaurant[]>()) ?? []) : [];
  const r = ids.map((id) => rows.find((x) => x.id === id)).find(Boolean) ?? null;
  if (!r) {
    console.warn("RevenueCat event for no known restaurant", event.id, event.type, event.app_user_id);
    if (event.type !== "TRANSFER") await alertBuilder(`store:unknown:${event.app_user_id}`, `App ${event.type} (${event.id}) for app user ${event.app_user_id}, which no restaurant has.`);
    return "unknown_restaurant";
  }
  if (event.type === "TRANSFER") {
    await alertBuilder(`store:transfer:${r.id}`, `${r.name}: an App Store / Google Play subscription was moved between DinerAI logins (RevenueCat TRANSFER, ${event.id}). Check it by hand.`);
    return "ignored";
  }
  const change = storeChange(event, r, APP_ENTITLEMENT());
  await db.from("revenuecat_events").update({ restaurant_id: r.id }).eq("id", event.id);
  if (!change) return "ignored";

  check(await db.from("restaurants").update(change.fields).eq("id", r.id).select("id"));
  // The founder dashboard's history (lib/founder/billing-history.ts). Test purchases aren't real money.
  if (event.environment !== "SANDBOX") {
    const at = change.fields.store_event_at ?? new Date().toISOString();
    const source = event.store === "PLAY_STORE" ? "play_store" : "app_store";
    await recordStandingChange({ restaurantId: r.id, before: r, after: { ...r, ...change.fields }, source, at, detail: change.note, cancelReason: event.type === "CANCELLATION" ? (event.cancel_reason ?? null) : null, externalId: event.id });
    const paid = storePayment(event);
    if (paid) await recordPayment({ restaurantId: r.id, source, at, ...paid });
  }
  const sandbox = event.environment === "SANDBOX";
  await logAction({ restaurantId: r.id, actor: "app store", action: "billing", detail: `${change.note}${sandbox ? " [test purchase]" : ""}`, data: { event: event.id, type: event.type, store: event.store ?? null, environment: event.environment ?? null } });
  // A test (sandbox) purchase on a real restaurant: probably App Review, or a mistake.
  if (sandbox && !r.is_demo && !(r as { is_test?: boolean }).is_test) {
    await alertBuilder(`store:sandbox:${r.id}`, `${r.name}: a test (sandbox) ${storeName(event.store)} purchase changed its subscription (${event.type}). App Review, or a test on a real restaurant?`);
  }
  if (change.fields.store_status === "past_due") await alertBuilder(`store:past_due:${r.id}`, `${r.name}: a ${storeName(event.store)} payment failed. DinerAI keeps running meanwhile.`);
  // The free month started: setup with Dina opens (made once, whichever comes first).
  if (change.fields.store_status === "trialing" || change.fields.store_status === "active") {
    const { startOnboarding } = await import("@/lib/onboarding/sessions");
    await startOnboarding(r.id, { channel: "web" });
  }
  // A paid month: the restaurant that recommended them gets their free month.
  if (isPaidMonth(event)) {
    const { creditReferralIfDue } = await import("./referrals");
    const fresh = check(await db.from("restaurants").select("*").eq("id", r.id).single<Restaurant>());
    if (fresh) await creditReferralIfDue(fresh, { id: event.id, amount_paid: 1, status: "paid" });
  }
  await syncActive(r.id);
  return "applied";
}
