import "server-only";
import Stripe from "stripe";

// The Stripe client: server only. A live key only works on the live site
// (VERCEL_ENV=production): previews and local copies refuse it, so testing can
// never charge real money.

export function isLiveKey(key: string) {
  return /^(sk|rk)_live_/.test(key);
}

export function keyAllowed(key: string, env: Record<string, string | undefined> = process.env) {
  return !isLiveKey(key) || env.VERCEL_ENV === "production";
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!keyAllowed(key)) throw new Error("STRIPE_SECRET_KEY is a live key, which only works on the live site. Use a test key here.");
  client ??= new Stripe(key, { appInfo: { name: "DinerAI" } });
  return client;
}
