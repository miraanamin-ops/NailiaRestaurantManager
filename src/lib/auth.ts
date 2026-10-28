import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isFreshUser, scopeToSignup, sessionIdFromToken } from "@/lib/auth-rules";
import { builderEmails } from "@/lib/builder-emails";
import { assertNotLiveByAccident } from "@/lib/live-guard";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Owner login: Supabase magic links (an email with a one-time link, no password).
// Only allowed emails can log in: each restaurant's owner_email, plus the
// builder (BUILDER_EMAIL, comma-separated for more than one).
// Protected: the data page (/), the activity log (/log) and weekly reports.
// Public: sign-up forms, rewards, offers, unsubscribe and the privacy notice.

export function authConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

// A Supabase client that reads and writes the login cookies of this request.
export async function authClient() {
  assertNotLiveByAccident();
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Pages can't set cookies while rendering; proxy.ts keeps the session fresh instead.
        }
      },
    },
  });
}


// Who can log in, and which restaurants they can see.
export async function accessFor(email: string) {
  const e = email.trim().toLowerCase();
  const isBuilder = builderEmails().includes(e);
  const owned =
    check(await getSupabase().from("restaurants").select("id, owner_email").returns<{ id: string; owner_email: string | null }[]>()) ?? [];
  const restaurantIds = isBuilder ? owned.map((r) => r.id) : owned.filter((r) => r.owner_email?.toLowerCase() === e).map((r) => r.id);
  return { email: e, isBuilder, restaurantIds, allowed: isBuilder || restaurantIds.length > 0 };
}

export type Owner = Awaited<ReturnType<typeof accessFor>>;

// The logged-in, allowed person, or null. A login made at sign-up sees only the
// restaurant it signed up (lib/auth-rules.ts).
export async function currentOwner(): Promise<Owner | null> {
  if (!authConfigured()) return null;
  const client = await authClient();
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) return null;
  // Supabase checks this exact token; only then is its session id read from it.
  const { data } = await client.auth.getUser(token);
  if (!data.user?.email) return null;
  const access = scopeToSignup(await accessFor(data.user.email), await signupRestaurantOf(sessionIdFromToken(token)));
  return access.allowed ? access : null;
}

// The restaurant a sign-up login is limited to (null: an ordinary login). If the
// list can't be read, nobody gets in, except before supabase/049 has run (no such
// logins can exist then).
async function signupRestaurantOf(sessionId: string | null) {
  if (!sessionId) return null;
  const { data, error } = await getSupabase().from("signup_sessions").select("restaurant_id").eq("session_id", sessionId).maybeSingle<{ restaurant_id: string }>();
  if (error?.code === "42P01") return null;
  if (error) throw new Error(`Couldn't check the login: ${error.message}`);
  return data?.restaurant_id ?? null;
}

export type SignupSession = { ok: true } | { ok: false; reason: "not_configured" | "existing_user" | "failed" };

// Logs a brand-new owner straight in after sign-up, with the same Supabase login
// a login link gives (the cookies verifyOtp sets, as on /auth/verify), but made
// on the server without sending the email. Only for a login account Supabase
// made just now; that session is then limited to this restaurant. Anything odd:
// not logged in, and the caller emails a login link instead.
export async function startSignupSession(email: string, restaurantId: string): Promise<SignupSession> {
  if (!authConfigured()) return { ok: false, reason: "not_configured" };
  const { data, error } = await getSupabase().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) {
    console.error("Couldn't make the sign-up login", error?.message);
    return { ok: false, reason: "failed" };
  }
  if (!isFreshUser(data.user)) return { ok: false, reason: "existing_user" };
  const client = await authClient();
  const verified = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  const sessionId = verified.data.session ? sessionIdFromToken(verified.data.session.access_token) : null;
  if (verified.error || !sessionId) {
    console.error("Couldn't start the sign-up login", verified.error?.message ?? "no session id");
    // A login that can't be limited to this restaurant must not stay.
    if (verified.data.session) await client.auth.signOut({ scope: "local" });
    return { ok: false, reason: "failed" };
  }
  const { error: recordError } = await getSupabase().from("signup_sessions").insert({ session_id: sessionId, restaurant_id: restaurantId });
  if (recordError) {
    // Never leave a sign-up login that isn't limited to its restaurant.
    console.error("Couldn't record the sign-up login; logging out", recordError.message);
    await client.auth.signOut({ scope: "local" });
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}

// For owner pages: sends anyone not logged in (or not allowed) to the login page.
export async function requireOwner(nextPath: string): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(safeNext(nextPath))}`);
  return owner;
}

// Which restaurant an owner page shows: the one asked for (?r=…) if this person
// may see it, otherwise their first. Never one they can't see.
export function pickRestaurantId(owner: Owner, requested: string | string[] | undefined) {
  const want = Array.isArray(requested) ? requested[0] : requested;
  return want && owner.restaurantIds.includes(want) ? want : (owner.restaurantIds[0] ?? null);
}

// Names of the restaurants this person can switch between (the builder sees all).
export async function restaurantChoices(owner: Owner) {
  if (owner.restaurantIds.length < 2) return [];
  return (
    check(
      await getSupabase().from("restaurants").select("id, name").in("id", owner.restaurantIds).order("created_at").returns<{ id: string; name: string }[]>(),
    ) ?? []
  );
}

// Only ever redirect within this site after logging in.
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// Emails a one-time login link that lands on `next`. "implicit": the link in
// Supabase's standard email brings the login back after a "#" in the address, so
// it works in whichever browser opens it (no email template changes needed).
// /auth/confirm picks it up. Returns "wait" (too many emails just now), "send" or null.
export async function emailLoginLink(email: string, next: string, base: string) {
  if (!authConfigured()) {
    console.error("Can't send a login link: SUPABASE_PUBLISHABLE_KEY isn't set here");
    return "send" as const;
  }
  const sender = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await sender.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${base}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`, shouldCreateUser: true },
  });
  if (!error) return null;
  console.error("Magic link failed", error.message);
  return error.status === 429 ? ("wait" as const) : ("send" as const);
}
