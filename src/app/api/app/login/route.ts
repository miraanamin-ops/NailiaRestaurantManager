import type { NextRequest } from "next/server";
import { appError, appJson } from "@/lib/app-api";
import { accessFor, authConfigured, looksLikeEmail, tokenClient } from "@/lib/auth";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";

// The app's login: email and password, the same rules as the website's /login
// (only allowed emails; wrong email, wrong password and not allowed all get the
// same answer; 20 tries per connection and 8 per email in 15 minutes). Returns the
// Supabase session; the app keeps it in the phone's secure storage and refreshes it.
export async function POST(req: NextRequest) {
  if (!authConfigured()) return appError(503, "not_configured");
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(body?.password ?? "").slice(0, 200);
  if (!looksLikeEmail(email) || !password) return appError(401, "wrong");

  const limited = await overLimit([
    { key: limitKey("login-ip", clientIp(req.headers)), max: 20, windowMs: 15 * MINUTE },
    { key: limitKey("login-email", email), max: 8, windowMs: 15 * MINUTE },
  ]);
  if (limited) return appError(429, "slow");

  const client = tokenClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return appError(401, "wrong");
  if (!(await accessFor(email)).allowed) {
    // Not an owner or the builder: end the session Supabase just made.
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    return appError(401, "wrong");
  }
  const s = data.session;
  return appJson({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
}
