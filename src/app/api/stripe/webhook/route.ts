import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

// Stripe's events (set up in Stripe > Developers > Webhooks):
//   checkout.session.completed, customer.subscription.created / updated / deleted,
//   invoice.payment_failed
// Only events signed with STRIPE_WEBHOOK_SECRET are accepted. A repeat of an event
// already handled gets a 200 and does nothing (lib/billing/webhook.ts).
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "not signed" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.warn("Stripe webhook rejected", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error("Stripe webhook failed", event.id, event.type, err);
    // A 500 makes Stripe try again later.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
