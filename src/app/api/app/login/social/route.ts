import type { NextRequest } from "next/server";
import { appError, appJson } from "@/lib/app-api";
import { accessFor, authConfigured, tokenClient } from "@/lib/auth";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";

// Sign in with Apple or Google in the app (step 50, phase 4). The app gets an ID token
// from Apple or Google on the phone; Supabase checks it and gives a session (the same
// login accounts as the website, matched by email). Answers:
//   { known: true, tokens }       an owner (or the builder): logged in
//   { known: false, tokens, email, name }  nobody we know yet: the app goes on to the
//                                 sign-up form with that email (POST /api/app/signup
//                                 with these tokens); the login sees nothing until then.
const PROVIDERS = new Set(["apple", "google"]);

export async function POST(req: NextRequest) {
  if (!authConfigured()) return appError(503, "not_configured");
  const body = (await req.json().catch(() => null)) as { provider?: unknown; idToken?: unknown; nonce?: unknown; name?: unknown } | null;
  const provider = String(body?.provider ?? "");
  const idToken = typeof body?.idToken === "string" ? body.idToken.slice(0, 8000) : "";
  if (!PROVIDERS.has(provider) || !idToken) return appError(400, "bad_login");
  if (await overLimit([{ key: limitKey("social-login-ip", clientIp(req.headers)), max: 20, windowMs: 15 * MINUTE }])) return appError(429, "slow");

  const client = tokenClient();
  const { data, error } = await client.auth.signInWithIdToken({
    provider: provider as "apple" | "google",
    token: idToken,
    ...(typeof body?.nonce === "string" && body.nonce ? { nonce: body.nonce.slice(0, 200) } : {}),
  });
  if (error || !data.session || !data.user?.email) {
    console.warn("Social login refused", provider, error?.message);
    return appError(401, "wrong");
  }
  const s = data.session;
  const tokens = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at };
  const email = data.user.email.toLowerCase();
  if ((await accessFor(email)).allowed) return appJson({ known: true, tokens });
  // Apple only sends the name the very first time: the app passes it on for the form.
  const meta = (data.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const name = (typeof body?.name === "string" && body.name.trim() ? body.name.trim() : (meta.full_name ?? meta.name ?? "")).slice(0, 80);
  return appJson({ known: false, tokens, email, name: name || null });
}
