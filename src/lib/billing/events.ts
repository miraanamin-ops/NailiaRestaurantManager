import type Stripe from "stripe";
import type { BillingFields } from "./access";

// What each Stripe event changes on the restaurant, as plain code
// (tests/billing-webhook.test.ts). The webhook (lib/billing/webhook.ts) finds the
// restaurant, applies these fields, logs the detail and alerts the builder.

export const HANDLED = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export type BillingUpdate = BillingFields & {
  stripe_customer_id?: string;
  stripe_subscription_id?: string | null;
  billing_event_at?: string;
};

export type EventPlan = {
  fields: BillingUpdate;
  detail: string; // one line for the audit log
  alert?: string; // for the builder (never the owner)
};

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));
const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

// The Stripe customer an event is about.
export function eventCustomer(event: Stripe.Event): string | null {
  const o = event.data.object as { customer?: string | { id: string } | null };
  return idOf(o.customer);
}

// Our restaurant id, if Stripe carried it (metadata on Checkout and on the subscription).
export function eventRestaurantId(event: Stripe.Event): string | null {
  const o = event.data.object as { metadata?: Record<string, string> | null; client_reference_id?: string | null };
  return o.metadata?.restaurant_id || o.client_reference_id || null;
}

// null = nothing to change for this event (a type we don't use, or not a finished subscription checkout).
export function planEvent(event: Stripe.Event, current: { billing_event_at?: string | null }): EventPlan | null {
  const at = new Date(event.created * 1000).toISOString();
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription" || s.status !== "complete") return null;
      const customer = idOf(s.customer);
      return {
        fields: { ...(customer ? { stripe_customer_id: customer } : {}), stripe_subscription_id: idOf(s.subscription) },
        detail: "Checkout finished: card saved and subscription started",
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      // Stripe doesn't promise the order events arrive in: never let an older one undo a newer one.
      if (current.billing_event_at && Date.parse(at) < Date.parse(current.billing_event_at)) {
        return { fields: {}, detail: `Older Stripe event (${event.type}) arrived late: ignored` };
      }
      const periodEnd = sub.items?.data?.[0]?.current_period_end ?? null;
      const cancelling = Boolean(sub.cancel_at_period_end || sub.cancel_at) && event.type !== "customer.subscription.deleted";
      const fields: BillingUpdate = {
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        trial_ends_at: iso(sub.trial_end),
        current_period_end: iso(periodEnd),
        cancel_at_period_end: cancelling,
        billing_event_at: at,
        ...(sub.status === "active" || sub.status === "trialing" ? { payment_failed_at: null } : {}),
      };
      const customer = idOf(sub.customer);
      if (customer) fields.stripe_customer_id = customer;

      if (event.type === "customer.subscription.deleted") {
        return { fields, detail: "Subscription ended", alert: "Subscription ended (cancelled or unpaid). The restaurant is switched off; its data is kept." };
      }
      const previous = (event.data as { previous_attributes?: { cancel_at_period_end?: boolean; cancel_at?: number | null } }).previous_attributes;
      const justCancelled = cancelling && previous && (previous.cancel_at_period_end === false || previous.cancel_at === null);
      const ends = sub.cancel_at ?? periodEnd;
      if (justCancelled) {
        return { fields, detail: `Cancellation scheduled: ends ${ends ? day(ends) : "at the end of the period"}`, alert: `Owner cancelled. Ends ${ends ? day(ends) : "at period end"}.` };
      }
      const trial = sub.status === "trialing" && sub.trial_end ? `, free trial until ${day(sub.trial_end)}` : "";
      const verb = event.type === "customer.subscription.created" ? "Subscription started" : "Subscription updated";
      return { fields, detail: `${verb}: ${sub.status}${trial}` };
    }
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const amount = `£${((inv.amount_due ?? 0) / 100).toFixed(2)}`;
      return {
        fields: { payment_failed_at: at },
        detail: `Payment failed (${amount}, attempt ${inv.attempt_count ?? 1})`,
        alert: `Payment failed: ${amount}, attempt ${inv.attempt_count ?? 1}. Stripe will retry; the restaurant keeps running and settings shows a banner.`,
      };
    }
    default:
      return null;
  }
}
