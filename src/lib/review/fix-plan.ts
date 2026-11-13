// Which Google profile fixes the business review can make, as pure rules. Code
// fills structured fields from what the owner told us (the restaurant profile);
// AI only ever writes the description. Never invent a fact: what we don't know
// becomes a question from Dina. And never overwrite: the API only fills fields
// that are empty on Google; a change to something already there (re-verification
// risk) is a copy-paste instruction for the owner instead.
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, HEALTH_RUBRIC, upcomingSpecialDates, type AttributeKey, type ProfileSnapshot } from "./health";

// What we know from setup (columns on restaurants).
export type KnownFacts = {
  name: string;
  phone: string | null;
  website: string | null;
  opening_hours: Record<string, string> | null;
  special_hours: Record<string, { label?: string | null; hours: string }> | null;
  halal_statement: string | null;
  faqs: Record<string, string> | null;
  logo_url: string | null;
  cuisine: string | null;
};

export type ApplyField = "description" | "phone" | "website" | "regular_hours" | "special_hours" | "attributes" | "logo";
export type ApplyFix = { field: ApplyField; label: string; value: unknown };
export type CopyPaste = { label: string; text: string };
export type FixPlan = {
  apply: ApplyFix[];
  copyPaste: CopyPaste[];
  asks: string[];
  // The description to write (AI): "fill" = Google's is empty (the API writes it);
  // "longer" = Google's is short (a copy-paste suggestion, never overwritten).
  description: "fill" | "longer" | null;
};

const YES = /^\s*(yes|yep|yeah|yup|we do|we have|there is|there's|free|plenty|of course|absolutely|step-free|fully)\b/i;
const NO = /^\s*(no|nope|none|not|sadly not|unfortunately not|we don't|there isn't)\b/i;

// A yes/no answer the owner gave in words (null: it doesn't clearly say).
export function yesNo(answer: string | null | undefined): boolean | null {
  if (!answer || answer === "(not answered)") return null;
  if (NO.test(answer)) return false;
  if (YES.test(answer)) return true;
  return null;
}

// What the owner told us about each attribute (null: we don't know).
export function knownAttributes(f: KnownFacts): Record<AttributeKey, boolean | null> {
  const faqs = f.faqs ?? {};
  return {
    halal: yesNo(f.halal_statement) ?? yesNo(faqs.halal),
    vegetarian: null, // never assumed from the menu: asked
    parking: yesNo(faqs.parking),
    wheelchair: yesNo(faqs.accessibility),
    outdoor_seating: yesNo(faqs.outdoor_seating),
  };
}

const empty = (v: string | null | undefined) => !v || !v.trim();
const dateLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function planFixes(p: ProfileSnapshot, f: KnownFacts, now: Date): FixPlan {
  const apply: ApplyFix[] = [];
  const copyPaste: CopyPaste[] = [];
  const asks: string[] = [];
  let description: FixPlan["description"] = null;

  const desc = (p.description ?? "").trim();
  if (!desc) description = "fill";
  else if (desc.length < HEALTH_RUBRIC.description_long.minChars) description = "longer";

  if (!p.primaryCategory) copyPaste.push({ label: "A primary category", text: `In Google, open your profile, tap Edit profile, then Business category, and pick the one that fits best${f.cuisine ? ` (for example "${f.cuisine} restaurant")` : ""}.` });
  if (!p.additionalCategories.length) copyPaste.push({ label: "Secondary categories", text: "In Google, open your profile, tap Edit profile, then Business category, then Add another category. Add the other kinds of food you serve." });

  if (!p.hasRegularHours) {
    if (f.opening_hours && Object.keys(f.opening_hours).length) apply.push({ field: "regular_hours", label: "Your opening hours", value: f.opening_hours });
    else asks.push("your opening hours");
  }

  const needed = upcomingSpecialDates(now);
  if (needed.length && !needed.some((d) => p.specialHourDates.includes(d))) {
    const ours = Object.fromEntries(Object.entries(f.special_hours ?? {}).filter(([d]) => needed.includes(d)));
    if (!Object.keys(ours).length) asks.push("your Christmas and New Year hours");
    else if (!p.specialHourDates.length) apply.push({ field: "special_hours", label: "Your Christmas and New Year hours", value: ours });
    else
      copyPaste.push({
        label: "Your Christmas and New Year hours",
        text: `In Google, open your profile, tap Edit profile, then Hours, then Special hours, and add: ${Object.entries(ours)
          .map(([d, v]) => `${dateLabel(d)}: ${v.hours}`)
          .join("; ")}.`,
      });
  }

  if (empty(p.phone)) {
    if (!empty(f.phone)) apply.push({ field: "phone", label: "Your phone number", value: f.phone!.trim() });
    else asks.push("your phone number");
  }
  if (empty(p.website)) {
    if (!empty(f.website)) apply.push({ field: "website", label: "Your website", value: f.website!.trim() });
  }
  if (empty(p.menuLink)) asks.push("a link to your menu online (if you have one)");

  const known = knownAttributes(f);
  const fill: Partial<Record<AttributeKey, boolean>> = {};
  const unknown: string[] = [];
  for (const k of ATTRIBUTE_KEYS) {
    if (p.attributes[k] !== null && p.attributes[k] !== undefined) continue; // set on Google already: left alone
    if (known[k] === null) unknown.push(ATTRIBUTE_LABELS[k]);
    else fill[k] = known[k]!;
  }
  if (Object.keys(fill).length) {
    apply.push({
      field: "attributes",
      label: `What customers filter by: ${Object.entries(fill)
        .map(([k, v]) => `${ATTRIBUTE_LABELS[k as AttributeKey]} (${v ? "yes" : "no"})`)
        .join(", ")}`,
      value: fill,
    });
  }
  if (unknown.length) asks.push(`whether you have ${unknown.join(", ")}`);

  if (p.photoCount < HEALTH_RUBRIC.photos.good || !p.latestPhotoAt) {
    copyPaste.push({ label: "More recent photos", text: "Send me a few photos of your food and the restaurant here and I'll turn them into Google posts. Or add them in Google: open your profile, tap Add photos." });
  }
  if (!p.hasLogo) {
    if (!empty(f.logo_url)) apply.push({ field: "logo", label: "Your logo", value: f.logo_url });
    else copyPaste.push({ label: "A logo", text: "In Google, open your profile, tap Add photos, then Logo, and upload your logo." });
  }
  if (!p.hasCover) copyPaste.push({ label: "A cover photo", text: "In Google, open your profile, tap Add photos, then Cover photo, and pick your best photo of the food or the room." });

  return { apply, copyPaste, asks, description };
}

// The fixes counted in the message (ready now: written for them, or a copy-paste step).
export const readyFixes = (plan: FixPlan) => plan.apply.length + plan.copyPaste.length + (plan.description === "fill" ? 1 : 0) + (plan.description === "longer" ? 1 : 0);

// The two most valuable ready fixes, for "e.g. ..." (rubric points first).
export function topExamples(plan: FixPlan): string[] {
  const weight: Record<string, number> = {
    "A longer description": HEALTH_RUBRIC.description_long.points,
    "A description": HEALTH_RUBRIC.description.points + HEALTH_RUBRIC.description_long.points,
    "Your opening hours": HEALTH_RUBRIC.regular_hours.points,
    "Your Christmas and New Year hours": HEALTH_RUBRIC.special_hours.points,
    "A primary category": HEALTH_RUBRIC.primary_category.points,
    "Your phone number": HEALTH_RUBRIC.phone.points,
    "Your website": HEALTH_RUBRIC.website.points,
    "More recent photos": HEALTH_RUBRIC.photos.points,
    "Secondary categories": HEALTH_RUBRIC.secondary_categories.points,
    "Your logo": HEALTH_RUBRIC.logo.points,
    "A logo": HEALTH_RUBRIC.logo.points,
    "A cover photo": HEALTH_RUBRIC.cover.points,
  };
  const labels = [
    ...(plan.description === "fill" ? ["A description"] : plan.description === "longer" ? ["A longer description"] : []),
    ...plan.apply.map((a) => (a.field === "attributes" ? "Details customers filter by" : a.label)),
    ...plan.copyPaste.map((c) => c.label),
  ];
  return [...labels].sort((a, b) => (weight[b] ?? 5) - (weight[a] ?? 5)).slice(0, 2);
}

// The profile as it would be with the fixes applied (for the "after" score in a dry run).
export function withFixes(p: ProfileSnapshot, apply: ApplyFix[], description: string | null): ProfileSnapshot {
  const out: ProfileSnapshot = { ...p, attributes: { ...p.attributes } };
  if (description && !(p.description ?? "").trim()) out.description = description;
  for (const a of apply) {
    if (a.field === "phone" && empty(out.phone)) out.phone = String(a.value);
    if (a.field === "website" && empty(out.website)) out.website = String(a.value);
    if (a.field === "regular_hours") out.hasRegularHours = true;
    if (a.field === "special_hours" && !out.specialHourDates.length) out.specialHourDates = Object.keys(a.value as object);
    if (a.field === "logo") out.hasLogo = true;
    if (a.field === "attributes") for (const [k, v] of Object.entries(a.value as object)) if (out.attributes[k as AttributeKey] == null) out.attributes[k as AttributeKey] = v as boolean;
  }
  return out;
}

// ---------- The description Dina writes, and the draft the owner approves ----------

export const DESCRIPTION_CHARS = { min: 250, max: 750 } as const;

// Plain-code rules for Google's description (Google refuses links and phone
// numbers in it; we refuse claims nobody can check).
export function descriptionProblems(text: string, name: string): string[] {
  const t = text.trim();
  const p: string[] = [];
  if (t.length < DESCRIPTION_CHARS.min) p.push(`It's ${t.length} characters; it must be at least ${DESCRIPTION_CHARS.min}.`);
  if (t.length > DESCRIPTION_CHARS.max) p.push(`It's ${t.length} characters; Google allows ${DESCRIPTION_CHARS.max}.`);
  if (/https?:\/\/|www\.|\.co\.uk|\.com\b/i.test(t)) p.push("No links: Google doesn't allow them in the description.");
  if (/(\+?\d[\d\s]{8,}\d)/.test(t)) p.push("No phone numbers: Google doesn't allow them in the description.");
  if (/£\s?\d/.test(t)) p.push("No prices.");
  if (/\b(best|no\.?\s?1|number one|award[- ]winning|finest|famous|#1)\b/i.test(t)) p.push("No claims nobody can check (best, award-winning, famous).");
  if (t.includes("—")) p.push("No em-dashes.");
  if (!t.toLowerCase().includes(name.trim().toLowerCase())) p.push(`Use the restaurant's name, "${name}".`);
  return p;
}

// The draft's words: what will be filled in, and nothing else (the gate fills
// only what's still empty when it runs).
export function fixDraftText(plan: FixPlan, description: string | null) {
  const lines = ["Filling in what's empty on your Google profile (nothing you've written is changed):", ""];
  let n = 1;
  if (description && plan.description === "fill") lines.push(`${n++}. Description: "${description}"`);
  for (const a of plan.apply) {
    if (a.field === "regular_hours") lines.push(`${n++}. ${a.label}: ${Object.entries(a.value as Record<string, string>).map(([d, h]) => `${d.slice(0, 3)} ${h}`).join(", ")}`);
    else if (a.field === "special_hours") lines.push(`${n++}. ${a.label}: ${Object.entries(a.value as Record<string, { hours: string }>).map(([d, v]) => `${dateLabel(d)} ${v.hours}`).join(", ")}`);
    else if (a.field === "logo") lines.push(`${n++}. Your logo (the one on your sign-up page)`);
    else if (a.field === "attributes") lines.push(`${n++}. ${a.label}`);
    else lines.push(`${n++}. ${a.label}: ${String(a.value)}`);
  }
  return lines.join("\n");
}

// An owner's edit to the draft can change the description's words: read them back.
export function descriptionFromText(text: string): string | null {
  const m = text.match(/Description: "([\s\S]+?)"\s*(\n|$)/);
  return m ? m[1].trim() : null;
}
