import "server-only";
import Stripe from "stripe";

// The Stripe client: server only, and TEST keys only for now. A live key is
// refused, so nobody can be charged real money until that's deliberately changed.

export function isLiveKey(key: string) {
  return /^(sk|rk)_live_/.test(key);
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (isLiveKey(key)) throw new Error("STRIPE_SECRET_KEY is a live key. Billing only runs with Stripe test keys for now.");
  client ??= new Stripe(key, { appInfo: { name: "DinerAI" } });
  return client;
}
