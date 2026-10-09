import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/auth";

// Where the magic link in the login email lands. The email template sends a
// token_hash (works even if the link opens in a different browser app); a
// "code" (the default Supabase link) also works when it's the same browser.
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
