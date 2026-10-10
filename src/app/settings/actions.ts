"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import { DAYS, parseHoursText, type Hours } from "@/lib/onboarding/profile-data";
import { getRestaurant } from "@/lib/onboarding/store";
import { saveProfileFields } from "@/lib/profile-edits";

// The settings page's save buttons. Every change is logged (UNDO on WhatsApp puts it back).

async function own(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/settings?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return getRestaurant(restaurantId);
}

const back = (rid: string, params: string): never => redirect(`/settings?r=${rid}&${params}`);

export async function saveDetails(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));

  const hours: Hours = {};
  const unclear: string[] = [];
  for (const day of DAYS) {
    const typed = get(`hours_${day}`);
    if (!typed) continue;
    const value = parseHoursText(typed);
    if (value) hours[day] = value;
    else unclear.push(day);
  }
  if (unclear.length) back(r.id, `error=${encodeURIComponent(`Couldn't read the hours for ${unclear.join(", ")}. Try e.g. 12:00 – 22:00, or Closed.`)}`);

  const cap = Number(get("cap"));
  if (!(cap >= 0 && cap <= 100)) back(r.id, `error=${encodeURIComponent("The discount cap needs to be between 0 and 100.")}`);
  const website = get("website");
  await saveProfileFields(
    r,
    {
      opening_hours: hours,
      phone: get("phone") || null,
      address: get("address") || null,
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
      signup_reward: get("reward").slice(0, 100) || null,
      discount_cap_percent: Math.round(cap),
    },
    "Changed in settings",
  );
  back(r.id, "saved=details");
}

export async function saveSettingsMenu(restaurantId: string, menu: unknown) {
  const r = await own(restaurantId);
  // Dishes keep their confirmed allergens unless something about them changed.
  await saveProfileFields(r, { menu: cleanMenu(menu, r.menu ?? []) }, "Changed the menu in settings");
  back(r.id, "saved=menu");
}

export async function saveSettingsAllergens(restaurantId: string, menu: unknown) {
  const r = await own(restaurantId);
  const confirmed = cleanMenu(menu).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, allergens_confirmed: true })) }));
  await saveProfileFields(r, { menu: confirmed }, "Confirmed allergens in settings");
  back(r.id, "saved=allergens");
}
