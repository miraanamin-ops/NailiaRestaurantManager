import "server-only";
import { notFound, redirect } from "next/navigation";
import { authClient, authConfigured, currentOwner, safeNext } from "@/lib/auth";
import { signupScope } from "@/lib/auth-rules";
import { getSupabase } from "@/lib/supabase";
import { founderEmails } from "./emails";

// Who may open the founder dashboard (/admin): only FOUNDER_EMAIL
// (miraan@dinerai.co.uk), logged in with email and password. Anyone else, the
// builder and owners included, gets "Not found", so nobody learns it exists.
// A login made by a restaurant sign-up never counts, even with this email: a
// sign-up login hasn't proved it owns the address (lib/auth-rules.ts signupScope).

export { founderEmails, isFounderEmail } from "./emails";

export async function currentFounder(): Promise<{ email: string } | null> {
  if (!authConfigured() || !founderEmails().length) return null;
  const { data } = await (await authClient()).auth.getUser();
  const user = data.user;
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email || !founderEmails().includes(email)) return null;
  if (signupScope(null, user.app_metadata) !== null) return null;
  const session = (await (await authClient()).auth.getSession()).data.session;
  if (session) {
    const { sessionIdFromToken } = await import("@/lib/auth-rules");
    const sid = sessionIdFromToken(session.access_token);
    if (sid) {
      const { data: row, error } = await getSupabase().from("signup_sessions").select("restaurant_id").eq("session_id", sid).maybeSingle();
      if (error && error.code !== "42P01") return null;
      if (row) return null;
    }
  }
  return { email };
}

// For /admin pages and actions: not logged in -> the login page; logged in as
// anyone else -> Not found.
export async function requireFounder(nextPath = "/admin"): Promise<{ email: string }> {
  const founder = await currentFounder();
  if (founder) return founder;
  const owner = await currentOwner().catch(() => null);
  if (owner) notFound();
  const { data } = authConfigured() ? await (await authClient()).auth.getUser() : { data: { user: null } };
  if (data.user) notFound();
  redirect(`/login?next=${encodeURIComponent(safeNext(nextPath))}`);
}
