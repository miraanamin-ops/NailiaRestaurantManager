import type { NextRequest } from "next/server";
import { appError, appJson } from "@/lib/app-api";
import { accessFor, authConfigured, tokenClient } from "@/lib/auth";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";

// Keeps the app logged in: swaps the refresh token for a fresh session (Supabase
// rotates the refresh token each time). The app never talks to Supabase itself.
// A login whose email is no longer allowed (an owner removed) gets "login".
export async function POST(req: NextRequest) {
  if (!authConfigured()) return appError(503, "not_configured");
  const body = (await req.json().catch(() => null)) as { refresh_token?: unknown } | null;
  const refreshToken = String(body?.refresh_token ?? "").slice(0, 512);
  if (!refreshToken) return appError(401, "login");
  if (await overLimit([{ key: limitKey("app-refresh-ip", clientIp(req.headers)), max: 120, windowMs: 15 * MINUTE }])) return appError(429, "slow");

  const { data, error } = await tokenClient().auth.refreshSession({ refresh_token: refreshToken });
  const s = data.session;
  if (error || !s || !data.user?.email) return appError(401, "login");
  if (!(await accessFor(data.user.email)).allowed) return appError(401, "login");
  return appJson({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
}
