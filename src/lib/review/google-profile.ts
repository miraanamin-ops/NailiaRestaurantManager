import "server-only";
import { check, type Draft } from "@/lib/drafts";
import { googleModeFor } from "@/lib/google";
import * as api from "@/lib/google/api";
import { linkFor, type GoogleLink } from "@/lib/google/connections";
import { hoursToPeriods, specialToGoogle, type GSpecialPeriod } from "@/lib/google/mapping";
import { onceOnGoogle } from "@/lib/google/writes";
import { londonYmd } from "@/lib/clock";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { REVIEWS_MAX } from "./config";
import { descriptionFromText, type ApplyFix } from "./fix-plan";
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, type AttributeKey, type ProfileSnapshot } from "./health";

// The Google profile, read and filled in for the business review. Two homes:
//   live (and simulated) Google   the Business Information API (v1) and media (v4)
//   dummy Google                  restaurants.dummy_google_profile (test and demo sites)
// Writes only fill fields that are empty on Google: each field is read again
// just before it's written, and one that isn't empty any more is left alone.
// What was written is saved on the draft, so UNDO can empty it again.

export type DummyProfile = {
  rating?: number;
  reviewCount?: number;
  description?: string | null;
  primaryCategory?: string | null;
  additionalCategories?: string[];
  regularHours?: Record<string, string> | null;
  specialHours?: Record<string, { label?: string | null; hours: string }> | null;
  phone?: string | null;
  website?: string | null;
  menuLink?: string | null;
  attributes?: Partial<Record<AttributeKey, boolean | null>>;
  photos?: { at: string }[];
  logo?: string | null;
  cover?: string | null;
};

// What was filled in (saved on the draft as agent_input.applied).
export type Applied = { fields: string[]; attributes: AttributeKey[]; logoMedia: string | null; refused: string[] };

const db = () => getSupabase();
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === "object" && v !== null && !Array.isArray(v) && !Object.keys(v).length);

async function replyRate(restaurantId: string) {
  const rows = (check(await db().from("reviews").select("replied, reply_text").eq("restaurant_id", restaurantId).order("review_date", { ascending: false }).limit(REVIEWS_MAX)) ?? []) as { replied: boolean; reply_text: string | null }[];
  if (!rows.length) return null;
  return rows.filter((r) => r.replied || r.reply_text).length / rows.length;
}

// ---------- Attributes: our five, matched to Google's own ids by name ----------

const ATTRIBUTE_MATCH: Record<AttributeKey, RegExp> = {
  halal: /halal/i,
  vegetarian: /vegetarian/i,
  parking: /parking/i,
  wheelchair: /wheelchair[- ]accessible entrance|wheelchair/i,
  outdoor_seating: /outdoor seating/i,
};

export function attributeIds(meta: api.GAttributeMeta[]): Partial<Record<AttributeKey, string>> {
  const out: Partial<Record<AttributeKey, string>> = {};
  for (const k of ATTRIBUTE_KEYS) {
    const m = meta.find((x) => !x.deprecated && (x.valueType ?? "BOOL") === "BOOL" && ATTRIBUTE_MATCH[k].test(x.displayName ?? ""));
    if (m) out[k] = m.parent;
  }
  return out;
}
const MENU_ATTRIBUTE = /url_menu|menu/i;

// ---------- Reading ----------

export function snapshotFromDummy(p: DummyProfile, rate: number | null): ProfileSnapshot {
  const photos = p.photos ?? [];
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, p.attributes?.[k] ?? null])) as Record<AttributeKey, boolean | null>;
  return {
    description: p.description ?? null,
    primaryCategory: p.primaryCategory ?? null,
    additionalCategories: p.additionalCategories ?? [],
    hasRegularHours: !blank(p.regularHours),
    specialHourDates: Object.keys(p.specialHours ?? {}),
    phone: p.phone ?? null,
    website: p.website ?? null,
    menuLink: p.menuLink ?? null,
    attributes,
    photoCount: photos.length,
    latestPhotoAt: photos.map((x) => x.at).sort().at(-1) ?? null,
    hasLogo: Boolean(p.logo),
    hasCover: Boolean(p.cover),
    replyRate: rate,
  };
}

const ymd = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

async function readLive(link: GoogleLink, rate: number | null) {
  const [loc, attrs, meta, media] = await Promise.all([api.getProfileLocation(link), api.getAttributes(link), api.attributeMetadata(link), api.listMedia(link, 100)]);
  const ids = attributeIds(meta);
  const attributes = Object.fromEntries(
    ATTRIBUTE_KEYS.map((k) => {
      const a = ids[k] ? attrs.find((x) => x.name === ids[k]) : undefined;
      const v = a?.values?.[0];
      return [k, typeof v === "boolean" ? v : null];
    }),
  ) as Record<AttributeKey, boolean | null>;
  const menu = attrs.find((x) => MENU_ATTRIBUTE.test(x.name) && x.uriValues?.length);
  const photos = media.filter((m) => (m.mediaFormat ?? "PHOTO") === "PHOTO");
  const snapshot: ProfileSnapshot = {
    description: loc.profile?.description ?? null,
    primaryCategory: loc.categories?.primaryCategory?.displayName ?? null,
    additionalCategories: (loc.categories?.additionalCategories ?? []).map((c) => c.displayName ?? "").filter(Boolean),
    hasRegularHours: Boolean(loc.regularHours?.periods?.length),
    specialHourDates: (loc.specialHours?.specialHourPeriods ?? []).map((p) => ymd(p.startDate)),
    phone: loc.phoneNumbers?.primaryPhone ?? null,
    website: loc.websiteUri ?? null,
    menuLink: menu?.uriValues?.[0]?.uri ?? null,
    attributes,
    photoCount: photos.length,
    latestPhotoAt: photos.map((m) => m.createTime ?? "").filter(Boolean).sort().at(-1) ?? null,
    hasLogo: media.some((m) => m.locationAssociation?.category === "LOGO"),
    hasCover: media.some((m) => m.locationAssociation?.category === "COVER"),
    replyRate: rate,
  };
  return { snapshot, ids, loc };
}

// The profile as Google has it now. null: we can't see it (not connected).
export async function readProfile(r: Restaurant): Promise<ProfileSnapshot | null> {
  const rate = await replyRate(r.id);
  if ((await googleModeFor(r.id)) === "dummy") return r.dummy_google_profile ? snapshotFromDummy(r.dummy_google_profile as DummyProfile, rate) : null;
  const link = await linkFor(r.id);
  return link ? (await readLive(link, rate)).snapshot : null;
}

// ---------- Writing (only empty fields) ----------

type FixInput = { apply: ApplyFix[]; description: string | null };

function dummyApply(p: DummyProfile, fix: FixInput): { next: DummyProfile; applied: Applied } {
  const next: DummyProfile = { ...p, attributes: { ...(p.attributes ?? {}) } };
  const applied: Applied = { fields: [], attributes: [], logoMedia: null, refused: [] };
  const fill = <K extends keyof DummyProfile>(key: K, field: string, value: DummyProfile[K]) => {
    if (blank(next[key])) {
      next[key] = value;
      applied.fields.push(field);
    } else applied.refused.push(field);
  };
  if (fix.description) fill("description", "description", fix.description);
  for (const a of fix.apply) {
    if (a.field === "phone") fill("phone", "phone", String(a.value));
    if (a.field === "website") fill("website", "website", String(a.value));
    if (a.field === "regular_hours") fill("regularHours", "regular_hours", a.value as Record<string, string>);
    if (a.field === "special_hours") fill("specialHours", "special_hours", a.value as DummyProfile["specialHours"]);
    if (a.field === "logo") {
      if (blank(next.logo)) {
        next.logo = String(a.value);
        applied.logoMedia = "dummy-logo";
      } else applied.refused.push("logo");
    }
    if (a.field === "attributes") {
      for (const [k, v] of Object.entries(a.value as Record<string, boolean>)) {
        const key = k as AttributeKey;
        if (next.attributes![key] === null || next.attributes![key] === undefined) {
          next.attributes![key] = v;
          applied.attributes.push(key);
        } else applied.refused.push(`attribute:${key}`);
      }
    }
  }
  return { next, applied };
}

async function liveApply(link: GoogleLink, draftId: string, fix: FixInput): Promise<Applied> {
  const { snapshot, ids, loc } = await readLive(link, null);
  const applied: Applied = { fields: [], attributes: [], logoMedia: null, refused: [] };
  const body: Record<string, unknown> = {};
  const mask: string[] = [];
  const want = (field: string, isEmpty: boolean, set: () => void, maskName: string) => {
    if (!isEmpty) return void applied.refused.push(field);
    set();
    mask.push(maskName);
    applied.fields.push(field);
  };
  if (fix.description) want("description", blank(snapshot.description), () => (body.profile = { description: fix.description }), "profile.description");
  for (const a of fix.apply) {
    if (a.field === "phone") want("phone", blank(snapshot.phone), () => (body.phoneNumbers = { ...(loc.phoneNumbers ?? {}), primaryPhone: String(a.value) }), "phoneNumbers.primaryPhone");
    if (a.field === "website") want("website", blank(snapshot.website), () => (body.websiteUri = String(a.value)), "websiteUri");
    if (a.field === "regular_hours") want("regular_hours", !snapshot.hasRegularHours, () => (body.regularHours = { periods: hoursToPeriods(a.value as Record<string, string>) }), "regularHours");
    if (a.field === "special_hours")
      want("special_hours", !snapshot.specialHourDates.length, () => (body.specialHours = { specialHourPeriods: specialToGoogle(a.value as never, londonYmd(new Date())) as GSpecialPeriod[] }), "specialHours");
  }
  if (mask.length) await onceOnGoogle({ restaurantId: link.restaurant.id, key: `profile:${draftId}`, action: "profile" }, async () => (await api.patchProfile(link, body, mask), { at: new Date().toISOString() }));

  const attrFix = fix.apply.find((a) => a.field === "attributes");
  if (attrFix) {
    const set: api.GAttribute[] = [];
    for (const [k, v] of Object.entries(attrFix.value as Record<string, boolean>)) {
      const key = k as AttributeKey;
      const id = ids[key];
      if (!id || snapshot.attributes[key] !== null) {
        applied.refused.push(`attribute:${key}`);
        continue;
      }
      set.push({ name: id, values: [v] });
      applied.attributes.push(key);
    }
    if (set.length) await onceOnGoogle({ restaurantId: link.restaurant.id, key: `attributes:${draftId}`, action: "profile" }, async () => (await api.patchAttributes(link, set, set.map((s) => s.name)), { at: new Date().toISOString() }));
  }
  const logo = fix.apply.find((a) => a.field === "logo");
  if (logo) {
    if (snapshot.hasLogo) applied.refused.push("logo");
    else {
      const m = await onceOnGoogle({ restaurantId: link.restaurant.id, key: `logo:${draftId}`, action: "photo" }, async () => ({ name: (await api.createMedia(link, String(logo.value), "LOGO")).name }));
      applied.logoMedia = m.name;
    }
  }
  return applied;
}

// Applies an approved profile_fix draft (called by the release gate, lib/send.ts,
// only once it has passed every rule). Returns the owner's note.
export async function applyProfileFix(r: Restaurant, draft: Draft): Promise<string> {
  const input = (draft.agent_input ?? {}) as { apply?: ApplyFix[]; description?: string | null };
  // Edited by the owner: their words for the description (and only if it's still there).
  const description = (draft.version ?? 1) > 1 ? descriptionFromText(draft.content) : (input.description ?? null);
  const fix: FixInput = { apply: input.apply ?? [], description };
  let applied: Applied;
  if ((await googleModeFor(r.id)) === "dummy") {
    const fresh = check(await db().from("restaurants").select("dummy_google_profile").eq("id", r.id).maybeSingle<{ dummy_google_profile: DummyProfile | null }>());
    const out = dummyApply(fresh?.dummy_google_profile ?? {}, fix);
    check(await db().from("restaurants").update({ dummy_google_profile: out.next }).eq("id", r.id));
    applied = out.applied;
  } else {
    const link = await linkFor(r.id);
    if (!link) throw new Error("Google isn't linked any more");
    applied = await liveApply(link, draft.id, fix);
  }
  check(await db().from("drafts").update({ agent_input: { ...input, applied } }).eq("id", draft.id).eq("restaurant_id", r.id));
  const names = [...applied.fields.map((f) => FIELD_WORDS[f] ?? f), ...applied.attributes.map((k) => ATTRIBUTE_LABELS[k]), ...(applied.logoMedia ? ["your logo"] : [])];
  const kept = applied.refused.length ? ` ${applied.refused.length === 1 ? "One field wasn't" : `${applied.refused.length} fields weren't`} empty any more, so I left ${applied.refused.length === 1 ? "it" : "them"} as ${applied.refused.length === 1 ? "it was" : "they were"}.` : "";
  return names.length ? `📋 Filled in on Google: ${names.join(", ")}.${kept}` : `📋 Nothing to fill in: everything was already set on Google.${kept}`;
}

const FIELD_WORDS: Record<string, string> = { description: "your description", phone: "your phone number", website: "your website", regular_hours: "your opening hours", special_hours: "your Christmas and New Year hours" };

// UNDO: empties again exactly what the fix filled in (it was empty before).
export async function undoProfileFix(r: Restaurant, draft: Draft): Promise<string[]> {
  const applied = ((draft.agent_input ?? {}) as { applied?: Applied }).applied;
  if (!applied) return [];
  const undone: string[] = [];
  if ((await googleModeFor(r.id)) === "dummy") {
    const fresh = check(await db().from("restaurants").select("dummy_google_profile").eq("id", r.id).maybeSingle<{ dummy_google_profile: DummyProfile | null }>());
    const p: DummyProfile = { ...(fresh?.dummy_google_profile ?? {}), attributes: { ...(fresh?.dummy_google_profile?.attributes ?? {}) } };
    const keyOf: Record<string, keyof DummyProfile> = { description: "description", phone: "phone", website: "website", regular_hours: "regularHours", special_hours: "specialHours" };
    for (const f of applied.fields) (p as Record<string, unknown>)[keyOf[f]] = null;
    for (const k of applied.attributes) p.attributes![k] = null;
    if (applied.logoMedia) p.logo = null;
    check(await db().from("restaurants").update({ dummy_google_profile: p }).eq("id", r.id));
  } else {
    const link = await linkFor(r.id);
    if (!link) throw new Error("Google isn't linked any more");
    const maskOf: Record<string, [string, Record<string, unknown>]> = {
      description: ["profile.description", { profile: { description: "" } }],
      phone: ["phoneNumbers.primaryPhone", { phoneNumbers: { primaryPhone: "" } }],
      website: ["websiteUri", { websiteUri: "" }],
      regular_hours: ["regularHours", { regularHours: { periods: [] } }],
      special_hours: ["specialHours", { specialHours: { specialHourPeriods: [] } }],
    };
    const mask = applied.fields.map((f) => maskOf[f][0]);
    if (mask.length) await api.patchProfile(link, Object.assign({}, ...applied.fields.map((f) => maskOf[f][1])), mask);
    if (applied.attributes.length) {
      const ids = attributeIds(await api.attributeMetadata(link));
      const names = applied.attributes.map((k) => ids[k]).filter(Boolean) as string[];
      // In the mask with no value: unset.
      if (names.length) await api.patchAttributes(link, [], names);
    }
    if (applied.logoMedia) await api.deleteMedia(link, applied.logoMedia);
  }
  undone.push(...applied.fields.map((f) => FIELD_WORDS[f] ?? f), ...applied.attributes.map((k) => ATTRIBUTE_LABELS[k]), ...(applied.logoMedia ? ["your logo"] : []));
  return undone;
}
