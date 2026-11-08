import { NextResponse, type NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { finishedCheckout } from "@/lib/billing/checkout";
import { stripeConfigured } from "@/lib/billing/config";
import { getRestaurant } from "@/lib/onboarding/store";
import { baseUrlFrom } from "@/lib/supabase";

// Back from Stripe Checkout. The subscription itself is recorded by the webhook;
// this only checks with Stripe that Checkout really finished, then:
//   - already logged in as this restaurant's owner: straight into onboarding
//   - otherwise: the login page (email and the password chosen at sign-up), then onboarding.
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

  // The card is saved: setup with Dina opens (the webhook does the same; made once).
  const { startOnboarding } = await import("@/lib/onboarding/sessions");
  await startOnboarding(r.id, { channel: "web" }).catch((err) => console.error("Couldn't start onboarding after Checkout", err));
  const next = `/onboarding/chat?r=${r.id}`;
  const owner = await currentOwner();
  if (owner?.restaurantIds.includes(r.id)) return go(next);

  return go(`/login?paid=1&next=${encodeURIComponent(next)}`);
}
