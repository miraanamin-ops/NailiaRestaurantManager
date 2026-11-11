import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scopeToSignup, sessionIdFromToken, signupScope } from "@/lib/auth-rules";
import { builderEmails } from "@/lib/builder-emails";
import { assertNotLiveByAccident } from "@/lib/live-guard";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Owner login: email and password (Supabase Auth). An emailed link is only used to
// set or reset a password ("Forgot your password?").
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
  return ownerFromToken(token, client);
}

// A Supabase client with no cookies, for logins that carry their own token (the app).
export function tokenClient() {
  assertNotLiveByAccident();
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// The allowed person a login token belongs to, or null: the website's cookie login
// and the app's "Authorization: Bearer" login both end here, so the same rules apply.
export async function ownerFromToken(token: string, client: Pick<ReturnType<typeof tokenClient>, "auth"> = tokenClient()): Promise<Owner | null> {
  if (!authConfigured() || !token) return null;
  // Supabase checks this exact token; only then is its session id read from it.
  const { data } = await client.auth.getUser(token);
  if (!data.user?.email) return null;
  const scope = signupScope(await signupRestaurantOf(sessionIdFromToken(token)), data.user.app_metadata);
  const access = scopeToSignup(await accessFor(data.user.email), scope);
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

export type NewAccount = { ok: true } | { ok: false; reason: "not_configured" | "existing_user" | "failed" };

// Makes the login account for a brand-new owner with the password they chose at
// sign-up, and logs them in. Nobody has proved they own that email yet, so the
// account only ever sees the restaurant it signed up (lib/auth-rules.ts signupScope)
// until they open a password link we email. An email that already has a login
// account isn't touched: "existing_user", and they log in (or reset) as usual.
export async function createPasswordAccount(email: string, password: string, restaurantId: string): Promise<NewAccount> {
  if (!authConfigured()) return { ok: false, reason: "not_configured" };
  const { error } = await getSupabase().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { signup_restaurant_id: restaurantId },
  });
  if (error) {
    if (error.status === 422 || /already|exists|registered/i.test(error.message)) return { ok: false, reason: "existing_user" };
    console.error("Couldn't make the login account", error.message);
    return { ok: false, reason: "failed" };
  }
  return (await logInWithPassword(email, password)) ? { ok: true } : { ok: false, reason: "failed" };
}

// Logs in with email and password (sets the login cookies). True if Supabase accepted them.
export async function logInWithPassword(email: string, password: string) {
  if (!authConfigured()) return false;
  const { error } = await (await authClient()).auth.signInWithPassword({ email, password });
  if (error) console.warn("Password login refused", error.message);
  return !error;
}

// After a login from a link we emailed (a password reset): the person has shown the
// email is theirs, so a sign-up account is no longer limited to its first restaurant.
export async function markEmailProven() {
  const client = await authClient();
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user || !(user.app_metadata as { signup_restaurant_id?: unknown } | undefined)?.signup_restaurant_id) return;
  const { error } = await getSupabase().auth.admin.updateUserById(user.id, { app_metadata: { signup_restaurant_id: null } });
  if (error) console.error("Couldn't lift the sign-up limit after an email link", error.message);
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

// Emails a link to set a new password (Supabase's "Reset your password" email). It
// lands on /auth/confirm, which logs them in and goes on to /account/password.
// "implicit": the login comes back after a "#" in the address, so the link works in
// whichever browser opens it. Only call this for an allowed email (lib/auth.ts
// accessFor). An owner who has never logged in has no login account yet: one is made
// first (no password), so the email can go. Returns "wait" (too many emails just
// now), "send" or null.
export async function emailPasswordLink(email: string, base: string) {
  if (!authConfigured()) {
    console.error("Can't send a password link: SUPABASE_PUBLISHABLE_KEY isn't set here");
    return "send" as const;
  }
  const made = await getSupabase().auth.admin.createUser({ email, email_confirm: true });
  if (made.error && !(made.error.status === 422 || /already|exists|registered/i.test(made.error.message))) {
    console.error("Couldn't make a login account for a password link", made.error.message);
  }
  const sender = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await sender.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/confirm?next=${encodeURIComponent("/account/password?reset=1")}` });
  if (!error) return null;
  console.error("Password link failed", error.message);
  return error.status === 429 ? ("wait" as const) : ("send" as const);
}
