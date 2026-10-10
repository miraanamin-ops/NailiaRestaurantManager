import "server-only";
import { randomUUID } from "node:crypto";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { planProfileChanges, type ProfileChange, type ProfileFields } from "@/lib/onboarding/profile-changes";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Saves changes to the restaurant's details (from a WhatsApp message or the
// settings page). Each changed field is logged with its old value, all under one
// batch, so a single UNDO puts the whole change back.

// The restaurant details people can change: from onboarding and messages (ProfileFields),
// plus the email branding on the settings page.
export type EditableFields = ProfileFields &
  Pick<Restaurant, "logo_url" | "brand_color" | "brand_dark" | "tagline" | "reply_to_email" | "feedback_emails">;

const FIELD_NAMES: Record<keyof EditableFields, string> = {
  opening_hours: "opening hours",
  menu: "menu",
  signup_reward: "sign-up reward",
  discount_cap_percent: "discount cap",
  phone: "phone number",
  address: "address",
  website: "website",
  logo_url: "logo",
  brand_color: "button colour",
  brand_dark: "header colour",
  tagline: "tagline",
  reply_to_email: "reply-to email",
  feedback_emails: "feedback emails",
};

export async function saveProfileFields(restaurant: Restaurant, fields: Partial<EditableFields>, detail: string) {
  const keys = (Object.keys(fields) as (keyof EditableFields)[]).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(restaurant[k]));
  if (!keys.length) return [];
  const update = Object.fromEntries(keys.map((k) => [k, fields[k]]));
  check(await getSupabase().from("restaurants").update(update).eq("id", restaurant.id));
  const batchId = keys.length > 1 ? randomUUID() : null;
  for (const k of keys) {
    await logAction({
      restaurantId: restaurant.id,
      batchId,
      actor: "owner",
      action: "setting",
      detail: `${detail} (${FIELD_NAMES[k]})`,
      data: { field: k, before: restaurant[k] ?? null, after: fields[k] ?? null },
    });
  }
  return keys.map((k) => FIELD_NAMES[k]);
}

// A WhatsApp message like "change Friday hours to 11pm": what was changed, or what's unclear.
export async function applyProfileChanges(restaurant: Restaurant, changes: ProfileChange[]) {
  const plan = planProfileChanges(restaurant, changes);
  const saved = plan.lines.length ? await saveProfileFields(restaurant, plan.fields, "Changed by message") : [];
  const parts: string[] = [];
  if (saved.length) parts.push(`✅ Done:\n${plan.lines.map((l) => `- ${l}`).join("\n")}\n\nReply *UNDO* to change it back.`);
  else if (plan.unchanged && !plan.problems.length) parts.push("That's already how it is, so nothing changed.");
  if (plan.problems.length) parts.push(plan.problems.join("\n"));
  return parts.join("\n\n") || "Sorry, I didn't catch what to change. Try e.g. _change Friday hours to 11pm_.";
}
