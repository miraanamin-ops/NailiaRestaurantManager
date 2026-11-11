import type { NextRequest } from "next/server";
import { appError, appJson, bearerToken } from "@/lib/app-api";
import { authConfigured, createPasswordAccount, tokenClient, verifiedUserFromToken } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { markUsesApp } from "@/lib/app/app-user";
import { signUpRestaurant } from "@/lib/signup/signup";

// Signing up in the app (step 50, phase 4): the website's rules (lib/signup/signup.ts),
// with tokens instead of cookies. Two ways in:
//   - email and password: a brand-new email gets its login at once (limited to this
//     restaurant until the owner opens a link we email, as on the website); the
//     answer carries the app's tokens.
//   - after Sign in with Apple / Google (/api/app/login/social said "new"): the app
//     sends that login's token and no password; the email is the one Apple or Google
//     vouched for, and the app keeps the tokens it already has.
// Answers: { restaurantId, next: "setup" | "pay", tokens? } or { error } (the same
// codes as the website's /start?error=...; "exists" = log in instead).
type Body = { ownerName?: unknown; restaurantName?: unknown; email?: unknown; password?: unknown; whatsapp?: unknown; terms?: unknown; invite?: unknown; referral?: unknown };

export async function POST(req: NextRequest) {
  if (!authConfigured()) return appError(503, "not_configured");
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return appError(400, "missing");
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const token = bearerToken(req);
  const social = token ? await verifiedUserFromToken(token) : null;
  if (token && !social) return appError(401, "login");
  const email = social ? social.email : str(body.email, 200).trim().toLowerCase();
  const password = social ? null : str(body.password, 200);

  const outcome = await signUpRestaurant({
    ownerName: str(body.ownerName, 80),
    email,
    restaurantName: str(body.restaurantName, 80),
    whatsapp: str(body.whatsapp, 40),
    password,
    verifiedEmail: social?.email ?? null,
    terms: body.terms === true,
    invite: str(body.invite, 40),
    referral: str(body.referral, 40),
    channel: "app",
    ip: clientIp(req.headers),
  });
  if (outcome.kind === "error") return appError(outcome.code === "slow" ? 429 : 400, outcome.code);
  if (outcome.kind === "login") return appError(409, "exists");

  const next = outcome.kind === "setup" ? "setup" : "pay";
  const restaurantId = outcome.restaurant.id;
  await markUsesApp(restaurantId);
  if (social) return appJson({ restaurantId, next });

  // Email and password: the login (made now only for an email we've never seen), then tokens.
  if (outcome.brandNew) {
    const made = await createPasswordAccount(email, password!, restaurantId, { logIn: false });
    if (!made.ok && made.reason !== "existing_user") return appError(500, "account");
  }
  const { data, error } = await tokenClient().auth.signInWithPassword({ email, password: password! });
  // Someone else's login already has this email: only its own password gets in.
  if (error || !data.session) return appError(409, "exists");
  const s = data.session;
  return appJson({ restaurantId, next, tokens: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at } });
}
