import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/supabase";

// Signing in with Google (OAuth 2.0, web server flow). Scope business.manage,
// offline access so we get a refresh token, plus openid/email so we know which
// Google account it is. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google
// Cloud > Credentials > the "DinerAI web" OAuth client).

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/business.manage"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_MINUTES = 15;

export function oauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_KEY);
}

export const redirectUri = () => `${appUrl()}/api/google/callback`;

// Who started the login, for which restaurant, as what: signed, so the callback
// only accepts a login that our own page started, for the person logged in.
export type OAuthState = { r: string | null; as: "owner" | "manager"; email: string; back: string };

function stateSecret() {
  const s = process.env.LINK_SECRET || process.env.CRON_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("Missing LINK_SECRET or CRON_SECRET");
  return s;
}

export function signState(state: OAuthState, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...state, exp: now + STATE_MINUTES * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", stateSecret()).update(body).digest("base64url")}`;
}

export function readState(token: string | null, now = Date.now()): OAuthState | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac("sha256", stateSecret()).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState & { exp: number };
    return s.exp > now ? { r: s.r, as: s.as, email: s.email, back: s.back } : null;
  } catch {
    return null;
  }
}

// prompt=consent every time: Google only hands over a refresh token on consent.
export function authUrl(state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${AUTH_URL}?${p}`;
}

export type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; token_type: string };

// A refresh token Google no longer accepts (revoked, password changed, removed
// as a manager...). Only the owner logging in again fixes it.
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    const why = `${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`;
    // invalid_grant: the refresh token is dead. Anything else may be temporary.
    if (json.error === "invalid_grant" || json.error === "unauthorized_client") throw new GoogleAuthError(`Google refused the login (${why})`);
    throw new Error(`Google token call failed (${why})`);
  }
  return json;
}

export const exchangeCode = (code: string) => tokenCall({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
export const refreshAccess = (refreshToken: string) => tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" });

export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => {});
}

// The Google account in the id_token. It came straight from Google's token
// endpoint over HTTPS, so its signature doesn't need checking here.
export function idTokenIdentity(idToken: string | undefined): { sub: string; email: string | null } | null {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; email?: string };
    return payload.sub ? { sub: payload.sub, email: payload.email ?? null } : null;
  } catch {
    return null;
  }
}
