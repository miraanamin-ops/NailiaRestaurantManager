import "server-only";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { isTestMode } from "@/lib/test-mode";
import { mark, newLinkCode, nextStep, slugFor, type Progress, type StepId, type StepStatus } from "./steps";

// Onboarding progress, saved in one row per restaurant. The web wizard and the
// WhatsApp conversation both read and write this, so an owner can switch.

export type OnboardingData = {
  google?: { candidates?: GoogleCandidate[]; chosen?: string };
  menu?: { draft?: import("./profile-data").MenuCategory[] }; // the photos themselves are files in storage
  voice?: { samples?: { tone: string; voice: string; sample: string }[]; captions?: string[] };
  allergens?: { suggested?: boolean };
};
export type GoogleCandidate = { id: string; name: string; address: string };

export type Onboarding = {
  restaurant_id: string;
  steps: Progress;
  data: OnboardingData;
  wa_waiting: string | null;
  link_code: string | null;
  link_code_expires_at: string | null;
  pending_whatsapp: string | null;
  started_at: string;
  completed_at: string | null;
};

const LINK_CODE_DAYS = 7;

export async function getOnboarding(restaurantId: string) {
  return check(await getSupabase().from("onboarding").select("*").eq("restaurant_id", restaurantId).maybeSingle<Onboarding>());
}

export async function saveOnboarding(restaurantId: string, fields: Partial<Onboarding>) {
  return checkRow(await getSupabase().from("onboarding").update(fields).eq("restaurant_id", restaurantId).select("*").single<Onboarding>());
}

export async function markStep(restaurantId: string, step: StepId, status: StepStatus) {
  const o = await getOnboarding(restaurantId);
  if (!o) throw new Error("No onboarding for this restaurant");
  return saveOnboarding(restaurantId, { steps: mark(o.steps, step, status) });
}

export async function patchData(restaurantId: string, patch: Partial<OnboardingData>) {
  const o = await getOnboarding(restaurantId);
  if (!o) throw new Error("No onboarding for this restaurant");
  return saveOnboarding(restaurantId, { data: { ...o.data, ...patch } });
}

export async function updateRestaurantFields(restaurantId: string, fields: Partial<Restaurant>) {
  return checkRow(await getSupabase().from("restaurants").update(fields).eq("id", restaurantId).select("*").single<Restaurant>());
}

export async function getRestaurant(restaurantId: string) {
  return checkRow(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).single<Restaurant>());
}

export function isComplete(o: Onboarding | null) {
  return !o || Boolean(o.completed_at);
}

export function currentStep(o: Onboarding) {
  return nextStep(o.steps);
}

// A slug nobody else has: "rose-thyme", then "rose-thyme-2", ...
async function uniqueSlug(name: string) {
  const base = slugFor(name);
  const taken = new Set(
    (check(await getSupabase().from("restaurants").select("slug").like("slug", `${base}%`).returns<{ slug: string }[]>()) ?? []).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// The sign-up form: a new restaurant, not active until onboarding finishes, with a
// one-time code to link the owner's WhatsApp. In test mode it's a demo restaurant
// (its data can be cleared and its onboarding reset).
export async function createRestaurantFromSignup(input: { ownerName: string; email: string; restaurantName: string; whatsapp: string | null }) {
  const supabase = getSupabase();
  const restaurant = checkRow(
    await supabase
      .from("restaurants")
      .insert({
        name: input.restaurantName,
        owner_name: input.ownerName,
        owner_email: input.email,
        slug: await uniqueSlug(input.restaurantName),
        active: false,
        is_demo: isTestMode(),
        discount_cap_percent: 15,
        email_test_mode: true,
      })
      .select("*")
      .single<Restaurant>(),
  );
  checkRow(
    await supabase
      .from("onboarding")
      .insert({
        restaurant_id: restaurant.id,
        pending_whatsapp: input.whatsapp,
        link_code: newLinkCode(),
        link_code_expires_at: new Date(Date.now() + LINK_CODE_DAYS * 86_400_000).toISOString(),
      })
      .select("restaurant_id")
      .single(),
  );
  return restaurant;
}

// The same person signing up again before finishing: carry on with that restaurant.
// (Also stops one email making lots of restaurants: after 5 unfinished in a day,
// they all go to the newest one.)
export async function recentUnfinishedSignup(email: string, restaurantName: string) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows =
    check(
      await getSupabase()
        .from("restaurants")
        .select("*")
        .eq("owner_email", email)
        .eq("active", false)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .returns<Restaurant[]>(),
    ) ?? [];
  const sameName = rows.find((r) => r.name.trim().toLowerCase() === restaurantName.trim().toLowerCase());
  return sameName ?? (rows.length >= 5 ? rows[0] : null);
}

// A fresh link code (e.g. if the old one expired).
export async function refreshLinkCode(restaurantId: string) {
  return saveOnboarding(restaurantId, {
    link_code: newLinkCode(),
    link_code_expires_at: new Date(Date.now() + LINK_CODE_DAYS * 86_400_000).toISOString(),
  });
}

export type LinkResult =
  | { ok: true; restaurant: Restaurant; onboarding: Onboarding }
  | { ok: false; reason: "no_code" | "expired" | "number_taken" };

// Someone sent a link code from WhatsApp: that number becomes the restaurant's owner number.
// A number can only belong to one restaurant. In test mode, a number that belongs
// to a demo restaurant is moved (so one test phone can onboard several test restaurants).
export async function linkWhatsApp(code: string, number: string, ourNumber: string): Promise<LinkResult> {
  const supabase = getSupabase();
  const o = check(await supabase.from("onboarding").select("*").eq("link_code", code).maybeSingle<Onboarding>());
  if (!o) return { ok: false, reason: "no_code" };
  if (o.link_code_expires_at && new Date(o.link_code_expires_at) < new Date()) return { ok: false, reason: "expired" };

  const current = check(await supabase.from("restaurants").select("id, is_demo").eq("owner_whatsapp", number).maybeSingle<{ id: string; is_demo: boolean }>());
  if (current && current.id !== o.restaurant_id) {
    if (!(isTestMode() && current.is_demo)) return { ok: false, reason: "number_taken" };
    check(await supabase.from("restaurants").update({ owner_whatsapp: null }).eq("id", current.id));
  }
  const restaurant = await updateRestaurantFields(o.restaurant_id, { owner_whatsapp: number, whatsapp_from: ourNumber });
  // One-time: the code stops working once used.
  const onboarding = await saveOnboarding(o.restaurant_id, { link_code: null, link_code_expires_at: null });
  return { ok: true, restaurant, onboarding };
}
