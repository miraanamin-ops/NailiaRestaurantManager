import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { CHECKOUT_TAG, trialDays } from "./config";
import { getStripe } from "./stripe";

// Stripe Checkout (the card page) and the Customer Portal (Manage billing).
// The webhook (lib/billing/webhook.ts) is what records the subscription; these
// only send the owner to Stripe and back.

// The restaurant's Stripe customer, made once with our restaurant id on it.
export async function ensureStripeCustomer(r: Restaurant): Promise<string> {
  if (r.stripe_customer_id) return r.stripe_customer_id;
  const customer = await getStripe().customers.create(
    { email: r.owner_email ?? undefined, name: r.name, metadata: { restaurant_id: r.id } },
    { idempotencyKey: `customer-${r.id}` },
  );
  // Only if nobody saved one in the meantime (pressing the button twice).
  const saved = check(
    await getSupabase()
      .from("restaurants")
      .update({ stripe_customer_id: customer.id })
      .eq("id", r.id)
      .is("stripe_customer_id", null)
      .select("stripe_customer_id")
      .returns<{ stripe_customer_id: string }[]>(),
  );
  if (saved?.length) return customer.id;
  const row = check(await getSupabase().from("restaurants").select("stripe_customer_id").eq("id", r.id).single<{ stripe_customer_id: string | null }>());
  return row?.stripe_customer_id ?? customer.id;
}

// A Checkout page for the £99 a month subscription with the free trial.
// The card is collected now; the first charge is when the trial ends.
export async function createTrialCheckout(r: Restaurant, base: string): Promise<string> {
  const customer = await ensureStripeCustomer(r);
  const days = trialDays();
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: r.id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    payment_method_collection: "always",
    subscription_data: { metadata: { restaurant_id: r.id }, ...(days > 0 ? { trial_period_days: days } : {}) },
    metadata: { restaurant_id: r.id },
    locale: "en-GB",
    integration_identifier: CHECKOUT_TAG,
    success_url: `${base}/start/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/start?cancelled=1`,
  });
  if (!session.url) throw new Error("Stripe didn't return a Checkout address");
  return session.url;
}

// Back from Checkout: which restaurant paid, if the session really finished.
export async function finishedCheckout(sessionId: string): Promise<string | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.status !== "complete" || session.mode !== "subscription") return null;
  return session.metadata?.restaurant_id ?? session.client_reference_id ?? null;
}

// Stripe's own page to update the card, see invoices or cancel (at the end of the period).
export async function createPortalSession(r: Restaurant, returnUrl: string): Promise<string> {
  if (!r.stripe_customer_id) throw new Error("This restaurant has no Stripe customer");
  const portal = await getStripe().billingPortal.sessions.create({ customer: r.stripe_customer_id, return_url: returnUrl, locale: "en-GB" });
  return portal.url;
}
