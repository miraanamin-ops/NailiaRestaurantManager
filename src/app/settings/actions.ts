"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import { DAYS, parseHoursText, type Hours } from "@/lib/onboarding/profile-data";
import { getRestaurant } from "@/lib/onboarding/store";
import { validHex } from "@/lib/email/brand";
import { isEmail } from "@/lib/email/route";
import { isSupportedImage, saveLogo } from "@/lib/photos";
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

// Logo, colours, tagline and email settings (how customer emails look and behave).
export async function saveBrand(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const color = validHex(get("brand_color"));
  const dark = validHex(get("brand_dark"));
  if (!color || !dark) back(r.id, `error=${encodeURIComponent("Colours need to look like #c2410c.")}`);
  const replyTo = get("reply_to_email");
  if (replyTo && !isEmail(replyTo)) back(r.id, `error=${encodeURIComponent("That reply-to email doesn't look right.")}`);

  let logoUrl = form.get("remove_logo") === "yes" ? null : r.logo_url;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!isSupportedImage(logo.type)) back(r.id, `error=${encodeURIComponent("The logo needs to be a PNG, JPEG, GIF or WebP image (email apps don't show SVG).")}`);
    try {
      logoUrl = await saveLogo(r.id, Buffer.from(await logo.arrayBuffer()), logo.type as Parameters<typeof saveLogo>[2]);
    } catch (err) {
      back(r.id, `error=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't save the logo.")}`);
    }
  }
  await saveProfileFields(
    r,
    {
      logo_url: logoUrl,
      brand_color: color!,
      brand_dark: dark!,
      tagline: get("tagline").slice(0, 80) || null,
      reply_to_email: replyTo ? replyTo.toLowerCase() : null,
      feedback_emails: form.get("feedback_emails") === "yes",
    },
    "Changed email branding in settings",
  );
  back(r.id, "saved=brand");
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
