import { NextResponse, type NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/auth";

// The app's one-time web link (lib/auth.ts appWebLink) lands here, inside the app's own
// browser: Supabase's token logs that browser in, then on to the page. Unlike /auth/verify
// it doesn't count as the owner proving their email (nothing was emailed).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const next = safeNext(p.get("next"));
  const tokenHash = p.get("token_hash");
  let ok = false;
  if (tokenHash) {
    const { error } = await (await authClient()).auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    ok = !error;
    if (error) console.warn("App web link failed", error.message);
  }
  return NextResponse.redirect(new URL(ok ? next : `/login?next=${encodeURIComponent(next)}`, req.url));
}
