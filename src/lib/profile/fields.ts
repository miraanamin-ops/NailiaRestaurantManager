// The restaurant profile (docs/profile-schema.md), as far as it's stored so far:
// each field's section, who may change it, which agents read it, and the
// restaurants column(s) it lives in. No imports, so it's unit-tested.
//
// Fields from the schema that aren't stored yet are added with the agent that
// needs them.
import type { AgentName } from "@/lib/agents/definition";
import type { ChangeRule, ProfileSection } from "@/lib/agents/schema";

type Reader = Exclude<AgentName, "checker" | "profile-keeper">;

export type ProfileFieldDef = {
  section: ProfileSection;
  rule: ChangeRule;
  // Which agents get it. The checker and the profile keeper read every field.
  readBy: Reader[] | "all";
  // The restaurants column(s). One column: the value as stored. Several: an object.
  columns: string[];
  // Must be filled before a restaurant's agents leave shadow mode (phase 2 checklist).
  pilot: boolean;
  label: string;
};

const ALL = "all" as const;
const f = (section: ProfileSection, rule: ChangeRule, readBy: Reader[] | "all", columns: string[], pilot: boolean, label: string): ProfileFieldDef => ({
  section,
  rule,
  readBy,
  columns,
  pilot,
  label,
});

export const PROFILE_FIELDS = {
  // Identity
  name: f("identity", "confirm", ALL, ["name"], true, "name"),
  address: f("identity", "confirm", ["visibility", "growth"], ["address"], true, "address"),
  google_place_id: f("identity", "settings", ["reputation", "visibility", "insights"], ["google_place_id"], true, "Google listing"),
  cuisine: f("identity", "confirm", ["growth", "visibility"], ["cuisine"], true, "cuisine"),
  links: f("identity", "confirm", ["growth", "visibility"], ["website"], false, "website"),
  phone: f("identity", "confirm", ["reputation", "visibility"], ["phone"], false, "phone number"),
  // Owner
  owner_name: f("owner", "confirm", ["gm"], ["owner_name"], true, "your name"),
  sign_off_name: f("owner", "confirm", ["reputation"], ["sign_off_name"], true, "sign-off name"),
  // Voice
  tone_notes: f("voice", "auto", ["reputation", "growth", "visibility"], ["brand_voice"], true, "how you sound"),
  greeting: f("voice", "auto", ["reputation", "growth"], ["greeting"], false, "greeting"),
  words_to_avoid: f("voice", "auto", ["reputation", "growth", "visibility"], ["words_to_avoid"], false, "words to avoid"),
  emoji_allowed: f("voice", "confirm", ["reputation", "growth", "visibility"], ["emoji_allowed"], true, "emojis"),
  // Facts
  menu: f("facts", "confirm", ["reputation", "growth", "visibility", "insights"], ["menu"], true, "menu"),
  hours: f("facts", "confirm", ["gm", "reputation", "growth", "visibility"], ["opening_hours"], true, "opening hours"),
  special_hours: f("facts", "confirm", ["reputation", "growth", "visibility"], ["special_hours"], false, "special hours"),
  halal_statement: f("facts", "confirm", ["reputation", "growth", "visibility"], ["halal_statement"], true, "halal statement"),
  allergen_statement: f("facts", "confirm", ["reputation", "growth", "visibility"], ["allergen_statement"], true, "allergen statement"),
  complaint_contact: f("facts", "confirm", ["reputation"], ["complaint_contact"], true, "contact for complaints"),
  // Commercial
  recovery_offers: f("commercial", "confirm", ["reputation"], ["recovery_offers"], true, "recovery offers"),
  signup_offer: f("commercial", "confirm", ["growth"], ["signup_reward"], true, "sign-up reward"),
  // Brand kit
  logo: f("brand_kit", "confirm", [], ["logo_url"], true, "logo"),
  colours: f("brand_kit", "confirm", [], ["brand_color", "brand_dark"], true, "colours"),
  photo_library: f("brand_kit", "confirm", ["growth", "visibility"], ["photo_library"], false, "photo library"),
  // Controls: settings only, never changed by an agent
  discount_cap: f("controls", "settings", ["growth"], ["discount_cap_percent"], true, "discount cap"),
  send_window: f("controls", "settings", [], ["send_window_start", "send_window_end"], true, "sending hours"),
} satisfies Record<string, ProfileFieldDef>;

export type ProfileFieldName = keyof typeof PROFILE_FIELDS;
export const PROFILE_FIELD_NAMES = Object.keys(PROFILE_FIELDS) as ProfileFieldName[];

// Default emoji rule (decision 5): up to 2 in posts and campaigns, none in review replies.
export const DEFAULT_EMOJI_ALLOWED = { review_replies: 0, posts: 2, campaigns: 2 };

// Which profile field a restaurants column belongs to.
export function fieldForColumn(column: string): ProfileFieldName | null {
  return PROFILE_FIELD_NAMES.find((n) => PROFILE_FIELDS[n].columns.includes(column)) ?? null;
}

// For the profile keeper's output check (lib/agents/schema.ts profileChangeProblems).
export function profileFieldRule(field: string) {
  const def = (PROFILE_FIELDS as Record<string, ProfileFieldDef>)[field];
  return def ? { section: def.section, rule: def.rule } : null;
}

// A field's value from a restaurants row.
export function fieldValue(row: Record<string, unknown>, field: ProfileFieldName): unknown {
  const { columns } = PROFILE_FIELDS[field];
  if (columns.length === 1) return row[columns[0]] ?? null;
  return Object.fromEntries(columns.map((c) => [c, row[c] ?? null]));
}

// The profile an agent gets: only the fields it reads (everything for the checker
// and the profile keeper). Never customer data: none of it lives in the profile.
// safeMenu: the menu as customers may see it (allergens only once confirmed).
export function profileView(row: Record<string, unknown>, agent: AgentName, safeMenu: (menu: unknown) => unknown) {
  const out: Record<string, unknown> = {};
  for (const name of PROFILE_FIELD_NAMES) {
    const def = PROFILE_FIELDS[name];
    const reads = agent === "checker" || agent === "profile-keeper" || def.readBy === "all" || (def.readBy as AgentName[]).includes(agent);
    if (!reads) continue;
    out[name] = name === "menu" ? safeMenu(row.menu ?? []) : name === "emoji_allowed" ? (row.emoji_allowed ?? DEFAULT_EMOJI_ALLOWED) : fieldValue(row, name);
  }
  return out;
}

// Pilot fields that are still empty.
export function missingPilotFields(row: Record<string, unknown>) {
  const empty = (v: unknown) =>
    v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => x == null || x === ""));
  return PROFILE_FIELD_NAMES.filter((n) => PROFILE_FIELDS[n].pilot && empty(n === "hours" ? (Object.keys((row.opening_hours as object) ?? {}).length ? 1 : null) : fieldValue(row, n)));
}

// The columns to write to put a field back to an earlier value.
export function columnsFor(field: ProfileFieldName, value: unknown): Record<string, unknown> {
  const { columns } = PROFILE_FIELDS[field];
  if (columns.length === 1) return { [columns[0]]: value };
  const v = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(columns.filter((c) => c in v).map((c) => [c, v[c]]));
}

// Decision 14: an agent can't leave shadow mode until the fields it needs are filled.
export const GO_LIVE_FIELDS: Partial<Record<AgentName, ProfileFieldName[]>> = {
  reputation: ["sign_off_name", "complaint_contact", "recovery_offers", "halal_statement", "allergen_statement"],
  visibility: ["logo", "colours", "hours", "emoji_allowed", "photo_library"],
};

// The app's starting values: colours and the emoji setting always have one, so
// they only count as set once the owner changed them or confirmed them (a profile version).
export const DEFAULT_COLOURS = { brand_color: "#c2410c", brand_dark: "#1c1917" };
export const MIN_LIBRARY_PHOTOS = 5;

// confirmed: fields the owner has saved at least once (from profile_versions).
export function missingForGoLive(row: Record<string, unknown>, agent: AgentName, confirmed: ReadonlySet<string> = new Set()): ProfileFieldName[] {
  const empty = (v: unknown) =>
    v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.filter((x) => String(typeof x === "object" ? JSON.stringify(x) : x).trim()).length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
  const missing = (f: ProfileFieldName) => {
    const v = fieldValue(row, f);
    if (f === "photo_library") return !Array.isArray(v) || v.length < MIN_LIBRARY_PHOTOS;
    if (f === "colours") return !confirmed.has(f) && JSON.stringify(v) === JSON.stringify(DEFAULT_COLOURS);
    if (f === "emoji_allowed") return !confirmed.has(f) && (v == null || JSON.stringify(v) === JSON.stringify(DEFAULT_EMOJI_ALLOWED));
    return empty(v);
  };
  return (GO_LIVE_FIELDS[agent] ?? []).filter(missing);
}
