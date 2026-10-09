import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/auth";

// Login links that carry a token_hash (a customised Supabase email template) or a
// "code" (works when opened in the same browser that asked for it) land here via
// /auth/confirm. The standard Supabase email uses the other route: see /auth/confirm.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const next = safeNext(p.get("next"));
  const supabase = await authClient();

  const tokenHash = p.get("token_hash");
  const code = p.get("code");
  let ok = false;
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: (p.get("type") as EmailOtpType) ?? "email" });
    ok = !error;
    if (error) console.warn("Login link failed", error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error) console.warn("Login code failed", error.message);
  }

  return NextResponse.redirect(new URL(ok ? next : `/login?error=expired&next=${encodeURIComponent(next)}`, req.url));
}
