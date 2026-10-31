import "server-only";
import { randomUUID } from "node:crypto";
import { logAction } from "@/lib/audit";
import { planProfileChanges, type ProfileChange, type ProfileFields } from "@/lib/onboarding/profile-changes";
import { PROFILE_FIELDS } from "@/lib/profile/fields";
import { markReverted, planRevert } from "@/lib/profile/versions";
import { updateRestaurantColumns, type MenuRename } from "@/lib/ops/menu";
import { stripMenuIds } from "@/lib/ops/menu-ids";
import type { OpsSource } from "@/lib/ops/types";
import type { Restaurant } from "@/lib/supabase";

// Saves changes to the restaurant's details (from a WhatsApp message or the
// settings page). Each changed field is logged with its old value, all under one
// batch, so a single UNDO puts the whole change back.

// The restaurant details people can change: from onboarding and messages (ProfileFields),
// plus the email branding on the settings page.
export type EditableFields = ProfileFields &
  Pick<
    Restaurant,
    // Onboarding with Dina's Hello step
    | "name"
    | "cuisine"
    | "logo_url"
    | "brand_color"
    | "brand_dark"
    | "tagline"
    | "reply_to_email"
    | "feedback_emails"
    // Profile v1: how replies and messages sound (settings page)
    | "sign_off_name"
    | "greeting"
    | "complaint_contact"
    | "halal_statement"
    | "allergen_statement"
    | "recovery_offers"
    | "words_to_avoid"
    | "emoji_allowed"
    | "special_hours"
    // Dina's step 6 (053)
    | "faqs"
    // The owner (settings page): name, language, quiet hours
    | "owner_name"
    | "owner_language"
    | "quiet_hours_start"
    | "quiet_hours_end"
    // Offers (settings page)
    | "approved_offer_types"
    | "birthday_offer"
  >;

const FIELD_NAMES: Record<keyof EditableFields, string> = {
  name: "restaurant name",
  cuisine: "cuisine",
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
  sign_off_name: "sign-off name",
  greeting: "greeting",
  complaint_contact: "contact for complaints",
  halal_statement: "halal statement",
  allergen_statement: "allergen statement",
  recovery_offers: "recovery offers",
  words_to_avoid: "words to avoid",
  emoji_allowed: "emojis",
  special_hours: "special hours",
  faqs: "answers to common questions",
  owner_name: "your name",
  owner_language: "language",
  quiet_hours_start: "quiet hours start",
  quiet_hours_end: "quiet hours end",
  approved_offer_types: "kinds of offer",
  birthday_offer: "birthday offer",
};

// The menu goes through saveMenu (src/lib/ops/menu.ts): sent with the settings
// page's dish ids, or with `renames` from a rename message, it keeps the same
// dishes. It's compared and logged without the ids.
export async function saveProfileFields(
  restaurant: Restaurant,
  fields: Partial<EditableFields>,
  detail: string,
  opts: { source?: OpsSource; renames?: MenuRename[] } = {},
) {
  const plain: Partial<EditableFields> = fields.menu ? { ...fields, menu: stripMenuIds(fields.menu) } : fields;
  const keys = (Object.keys(plain) as (keyof EditableFields)[]).filter((k) => JSON.stringify(plain[k]) !== JSON.stringify(restaurant[k]));
  if (!keys.length) return [];
  const update = Object.fromEntries(keys.map((k) => [k, fields[k]]));
  // The values before the change, taken before anything is written (for the log and UNDO).
  const before = Object.fromEntries(keys.map((k) => [k, structuredClone(restaurant[k] ?? null)]));
  await updateRestaurantColumns(restaurant.id, update, { source: opts.source ?? "manual", renames: opts.renames });
  const batchId = keys.length > 1 ? randomUUID() : null;
  for (const k of keys) {
    await logAction({
      restaurantId: restaurant.id,
      batchId,
      actor: "owner",
      action: "setting",
      detail: `${detail} (${FIELD_NAMES[k]})`,
      data: { field: k, before: before[k], after: plain[k] ?? null, ...(k === "menu" && opts.renames?.length ? { renames: opts.renames } : {}) },
    });
  }
  return keys.map((k) => FIELD_NAMES[k]);
}

// A WhatsApp message like "change Friday hours to 11pm": what was changed, or what's unclear.
export async function applyProfileChanges(restaurant: Restaurant, changes: ProfileChange[]) {
  const plan = planProfileChanges(restaurant, changes);
  const saved = plan.lines.length
    ? await saveProfileFields(restaurant, plan.fields, "Changed by message", { source: "owner_message", renames: plan.renames })
    : [];
  const parts: string[] = [];
  if (saved.length) parts.push(`✅ Done:\n${plan.lines.map((l) => `- ${l}`).join("\n")}\n\nReply *UNDO* to change it back.`);
  else if (plan.unchanged && !plan.problems.length) parts.push("That's already how it is, so nothing changed.");
  if (plan.problems.length) parts.push(plan.problems.join("\n"));
  return parts.join("\n\n") || "Sorry, I didn't catch what to change. Try e.g. _change Friday hours to 11pm_.";
}

// Revert (settings page): puts one profile field back to its value before a
// change, as a new profile version. Not UNDO, which is the owner's WhatsApp
// command for their last action.
export async function revertProfileChange(restaurant: Restaurant, versionId: string) {
  const plan = await planRevert(restaurant.id, versionId);
  if (!plan.ok) return plan;
  const row = restaurant as unknown as Record<string, unknown>;
  await updateRestaurantColumns(restaurant.id, plan.columns);
  for (const [column, value] of Object.entries(plan.columns)) {
    await logAction({
      restaurantId: restaurant.id,
      actor: "owner",
      action: "profile_reverted",
      detail: `Reverted the ${PROFILE_FIELDS[plan.field].label}`,
      data: { field: column, before: row[column] ?? null, after: value, reverts: versionId },
    });
  }
  await markReverted(restaurant.id, versionId);
  return plan;
}
