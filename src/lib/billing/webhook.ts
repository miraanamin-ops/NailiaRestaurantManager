import "server-only";
import type Stripe from "stripe";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { syncActive } from "./activation";
import { eventCustomer, eventRestaurantId, planEvent } from "./events";

// One Stripe event, already signature-checked by the route (app/api/stripe/webhook).
// Each event is handled once: its id is stored first, and a repeat is skipped.
// If handling fails, the id is removed again so Stripe's retry gets another go.

export type WebhookResult = "applied" | "duplicate" | "ignored" | "unknown_restaurant";

export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  const db = getSupabase();
  const claimed = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (claimed.error) {
    if (claimed.error.code === "23505") return "duplicate";
    throw new Error(claimed.error.message);
  }
  try {
    return await apply(event);
  } catch (err) {
    await db.from("stripe_events").delete().eq("id", event.id);
    throw err;
  }
}

async function apply(event: Stripe.Event): Promise<WebhookResult> {
  const r = await restaurantFor(event);
  const plan = planEvent(event, { billing_event_at: r?.billing_event_at });
  if (!plan) return "ignored";
  if (!r) {
    console.warn("Stripe event for no known restaurant", event.id, event.type, eventCustomer(event));
    await alertBuilder(`billing:unknown:${eventCustomer(event)}`, `Stripe ${event.type} (${event.id}) for customer ${eventCustomer(event)}, which no restaurant has.`);
    return "unknown_restaurant";
  }

  const db = getSupabase();
  if (Object.keys(plan.fields).length) check(await db.from("restaurants").update(plan.fields).eq("id", r.id).select("id"));
  await db.from("stripe_events").update({ restaurant_id: r.id }).eq("id", event.id);
  await logAction({ restaurantId: r.id, actor: "stripe", action: "billing", detail: plan.detail, data: { event: event.id, type: event.type } });
  if (plan.alert) await alertBuilder(`billing:${event.type}:${r.id}`, `${r.name}: ${plan.alert}`);
  await syncActive(r.id);
  return "applied";
}

// Found by its Stripe customer; the first time (before we've saved the customer
// on it) by the restaurant id Stripe carries in the metadata.
async function restaurantFor(event: Stripe.Event): Promise<Restaurant | null> {
  const db = getSupabase();
  const customer = eventCustomer(event);
  if (customer) {
    const byCustomer = check(await db.from("restaurants").select("*").eq("stripe_customer_id", customer).maybeSingle<Restaurant>());
    if (byCustomer) return byCustomer;
  }
  const id = eventRestaurantId(event);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const byId = check(await db.from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
  // Never move a restaurant to a different Stripe customer.
  if (byId && byId.stripe_customer_id && customer && byId.stripe_customer_id !== customer) return null;
  return byId;
}
