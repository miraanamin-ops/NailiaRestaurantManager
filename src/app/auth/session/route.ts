import type { NextRequest } from "next/server";
import { authClient } from "@/lib/auth";

// The login page (/auth/confirm) hands over the login from the email link here,
// and this stores it in the login cookies. Supabase checks the tokens are genuine;
// which pages the person can then see is still decided by lib/auth.ts.
export async function POST(req: NextRequest) {
  // Only accept this from our own pages.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host && new URL(origin).host !== req.headers.get("x-forwarded-host")) {
    return new Response("Forbidden", { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown } | null;
  if (typeof body?.access_token !== "string" || typeof body?.refresh_token !== "string") {
    return new Response("Missing login details", { status: 400 });
  }
  const supabase = await authClient();
  const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error) {
    console.warn("Login from the email link failed", error.message);
    return new Response("Login failed", { status: 401 });
  }
  return new Response(null, { status: 204 });
}
