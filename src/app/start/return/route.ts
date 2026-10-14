import { NextResponse, type NextRequest } from "next/server";
import { currentOwner, emailLoginLink } from "@/lib/auth";
import { finishedCheckout } from "@/lib/billing/checkout";
import { stripeConfigured } from "@/lib/billing/config";
import { getRestaurant } from "@/lib/onboarding/store";
import { limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";

// Back from Stripe Checkout. The subscription itself is recorded by the webhook;
// this only checks with Stripe that Checkout really finished, then:
//   - already logged in as this restaurant's owner: straight into onboarding
//   - otherwise: email a login link (which lands on onboarding) and say "Check your email".
// Never logs anyone in by itself: that would let someone who typed another
// person's email into the form into that person's account.
export async function GET(req: NextRequest) {
  const base = baseUrlFrom(req.headers);
  const go = (path: string) => NextResponse.redirect(new URL(path, base), 303);
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  if (!stripeConfigured() || !sessionId) return go("/start");

  const restaurantId = await finishedCheckout(sessionId).catch((err) => {
    console.error("Couldn't check the Checkout session", err);
    return null;
  });
  if (!restaurantId) return go("/start?error=checkout");
  const r = await getRestaurant(restaurantId).catch(() => null);
  if (!r?.owner_email) return go("/start?error=checkout");

  const owner = await currentOwner();
  if (owner?.restaurantIds.includes(r.id)) return go(`/onboarding?r=${r.id}`);

  // Reloading this page doesn't send another email each time.
  if (await overLimit([{ key: limitKey("checkout-return", sessionId), max: 2, windowMs: 10 * MINUTE }])) return go("/start?sent=1&paid=1");
  const error = await emailLoginLink(r.owner_email, `/onboarding?r=${r.id}`, base);
  return go(error ? `/start?error=${error}&paid=1` : "/start?sent=1&paid=1");
}
