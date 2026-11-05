// The details every agent needs that setup didn't use to ask for (4 Nov): the
// sign-off name and emoji setting (tone step), the allergen statement (menu
// step), the kinds of offer the owner is happy with (rewards step), and the logo,
// colours and dish photos (customers and QR codes step). Dina hears them and puts
// them in her reply's notes ("details.sign_off_name"); code checks and saves them
// here. Plain code with no imports beyond types, so it's unit-tested
// (tests/dina-details.test.ts).
import type { ConfirmationData } from "@/components/chat/types";
import { OFFER_TYPE_LABELS, OFFER_TYPES, type OfferType } from "@/lib/offers";

// The wording Dina offers for the allergen statement; the owner can change it.
export const DEFAULT_ALLERGEN_STATEMENT =
  "Please tell us about any allergies or intolerances before you order. Our kitchen handles all 14 major allergens, so we can't guarantee any dish is completely free of them.";

// Emoji: yes is the app's default (none in review replies, up to 2 in posts and
// campaigns); no means none anywhere.
export const EMOJI_YES = { review_replies: 0, posts: 2, campaigns: 2 };
export const EMOJI_NO = { review_replies: 0, posts: 0, campaigns: 0 };

// How many dish photos setup suggests (Visibility doesn't need them to go live).
export const SUGGESTED_PHOTOS = 3;

export const DETAIL_NOTES = ["sign_off_name", "emoji", "allergen_statement", "offer_types", "min_margin"] as const;
export type DetailNote = (typeof DETAIL_NOTES)[number];

export type DetailFields = {
  sign_off_name?: string;
  emoji_allowed?: typeof EMOJI_YES;
  allergen_statement?: string;
  approved_offer_types?: OfferType[];
  min_margin_pct?: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%£]+/g, " ").trim();

// "2 for 1, % off" or "two_for_one, percent_off" -> the offer types they name.
export function offerTypesFrom(text: string): OfferType[] {
  const parts = text.split(/[,;\n]|\band\b/).map(norm).filter(Boolean);
  const out = new Set<OfferType>();
  for (const p of parts) {
    const byId = OFFER_TYPES.find((t) => norm(t.replace(/_/g, " ")) === p || t === p.replace(/ /g, "_"));
    const byLabel = OFFER_TYPES.find((t) => norm(OFFER_TYPE_LABELS[t]) === p);
    const loose =
      /2 for 1|two for one|bogof|buy one get one/.test(p) ? "two_for_one"
      : /kids? eat free/.test(p) ? "kids_eat_free"
      : /free/.test(p) ? "free_item"
      : /%|percent/.test(p) ? "percent_off"
      : /£|pounds? off|money off/.test(p) ? "money_off"
      : null;
    const t = byId ?? byLabel ?? loose;
    if (t) out.add(t);
  }
  return OFFER_TYPES.filter((t) => out.has(t));
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// Her notes -> the fields to save, and what couldn't be used (told to her next turn).
export function detailFields(notes: Partial<Record<DetailNote, string>>): { fields: DetailFields; problems: string[] } {
  const fields: DetailFields = {};
  const problems: string[] = [];
  if (notes.sign_off_name !== undefined) {
    const v = clean(notes.sign_off_name);
    if (v.length >= 2 && v.length <= 60) fields.sign_off_name = v;
    else problems.push("the sign-off name should be 2 to 60 characters (e.g. \"Amina, Ember & Spice\")");
  }
  if (notes.emoji !== undefined) {
    const v = norm(notes.emoji);
    if (/^(yes|y|ok|sure|fine|allowed|on)\b/.test(v)) fields.emoji_allowed = EMOJI_YES;
    else if (/^(no|n|none|never|off)\b/.test(v)) fields.emoji_allowed = EMOJI_NO;
    else problems.push("emoji should be yes or no");
  }
  if (notes.allergen_statement !== undefined) {
    const v = clean(notes.allergen_statement);
    if (v.length >= 20 && v.length <= 500) fields.allergen_statement = v;
    else problems.push("the allergen statement should be a sentence or two (20 to 500 characters)");
  }
  if (notes.offer_types !== undefined) {
    const types = offerTypesFrom(notes.offer_types);
    if (types.length) fields.approved_offer_types = types;
    else problems.push(`no kind of offer was recognised; they are: ${OFFER_TYPES.map((t) => OFFER_TYPE_LABELS[t]).join(", ")}`);
  }
  if (notes.min_margin !== undefined) {
    // "50%", "50", "the recommended" (50), "not sure" (50).
    const v = norm(notes.min_margin);
    const digits = v.match(/\d+/);
    const n = digits ? Number(digits[0]) : /recommend|default|not sure|fine|ok|yes/.test(v) ? 50 : NaN;
    if (Number.isInteger(n) && n >= 0 && n <= 90) fields.min_margin_pct = n;
    else problems.push("the minimum profit should be a whole number from 0 to 90 (50% is recommended)");
  }
  return { fields, problems };
}

// What Dina is given about the offer types: each one's name, for her quick replies.
export const OFFER_TYPE_HINT = OFFER_TYPES.map((t) => OFFER_TYPE_LABELS[t]).join("; ");

// ---------- The brand card (customers and QR codes step) ----------

export const isHexColour = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s.trim());

// "dark green", "#1B5E20", "1b5e20" -> a colour code, or null. Common names only:
// anything else, Dina asks for the colour code (or they pick one on the settings page).
const NAMED: Record<string, string> = {
  black: "#111111", white: "#ffffff", red: "#c62828", "dark red": "#8e1b1b", burgundy: "#7b1e3a", maroon: "#6d1a1a",
  orange: "#e65100", "burnt orange": "#c2410c", yellow: "#f9a825", gold: "#b8860b", mustard: "#c59b08",
  green: "#2e7d32", "dark green": "#1b5e20", "olive": "#6b7a1e", "olive green": "#6b7a1e", teal: "#00796b",
  blue: "#1565c0", "dark blue": "#0d2f6b", navy: "#1a237e", "navy blue": "#1a237e", "light blue": "#4f9fd8",
  purple: "#6a1b9a", pink: "#d81b60", brown: "#5d4037", grey: "#616161", gray: "#616161", "dark grey": "#333333", cream: "#f3e9d2", beige: "#d8c3a5",
};
export function colourFrom(text: string): string | null {
  const t = text.trim().toLowerCase();
  const hex = t.match(/#?([0-9a-f]{6})\b/);
  if (hex) return `#${hex[1]}`;
  return NAMED[t.replace(/\s+/g, " ")] ?? null;
}

export type BrandDraft = { logo_url?: string | null; brand_color?: string | null; from_website?: boolean };

// The card: the logo (as a picture) and the main colour, from the draft over what's saved.
export function brandCard(draft: BrandDraft | null | undefined, saved: { logo_url?: string | null; brand_color?: string | null }): ConfirmationData {
  const logo = draft?.logo_url ?? saved.logo_url ?? null;
  const colour = draft?.brand_color ?? saved.brand_color ?? null;
  return {
    title: "Your look",
    image: logo,
    fields: [
      { key: "logo", label: "Logo", value: logo ? (draft?.from_website ? "From your website (above)" : "Above") : null },
      { key: "brand_color", label: "Main colour", value: colour, colour: isHexColour(colour) ? colour : undefined },
    ],
  };
}
