import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

const builderEmails = () =>
  (process.env.BUILDER_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

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

// The logged-in, allowed person, or null.
export async function currentOwner(): Promise<Owner | null> {
  if (!authConfigured()) return null;
  const { data } = await (await authClient()).auth.getUser();
  if (!data.user?.email) return null;
  const access = await accessFor(data.user.email);
  return access.allowed ? access : null;
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
