// The Google profile health score, out of 100, in plain code (no AI): the same
// profile always gets the same score. The rubric (what counts, and how much) is
// HEALTH_RUBRIC below, the one place to change it. No imports, so it's unit-tested.

// What we can see of a Google profile (from the Business Profile API, or the
// dummy profile for test and demo sites).
export type ProfileSnapshot = {
  description: string | null;
  primaryCategory: string | null;
  additionalCategories: string[];
  hasRegularHours: boolean;
  specialHourDates: string[]; // "2026-12-25"
  phone: string | null;
  website: string | null;
  menuLink: string | null;
  // true / false as set on Google; null = not set (unknown to customers).
  attributes: Record<AttributeKey, boolean | null>;
  photoCount: number;
  latestPhotoAt: string | null;
  hasLogo: boolean;
  hasCover: boolean;
  // Of the latest reviews, the share with a reply (null = no reviews yet).
  replyRate: number | null;
};

export const ATTRIBUTE_KEYS = ["halal", "vegetarian", "parking", "wheelchair", "outdoor_seating"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  halal: "halal food",
  vegetarian: "vegetarian options",
  parking: "parking",
  wheelchair: "wheelchair access",
  outdoor_seating: "outdoor seating",
};

// The rubric. points: the most each item can score; they add up to 100.
export const HEALTH_RUBRIC = {
  description: { points: 8, label: "A description" },
  description_long: { points: 7, label: "A description of 250+ characters", minChars: 250 },
  primary_category: { points: 8, label: "A primary category" },
  secondary_categories: { points: 4, label: "Secondary categories" },
  regular_hours: { points: 10, label: "Opening hours" },
  special_hours: { points: 8, label: "Christmas and New Year hours" },
  phone: { points: 6, label: "A phone number" },
  website: { points: 6, label: "A website" },
  menu_link: { points: 6, label: "A menu link" },
  attributes: { points: 10, label: "Details customers filter by (halal, vegetarian, parking, wheelchair access, outdoor seating)" },
  photos: { points: 6, label: "At least 10 photos", good: 10, some: 5 },
  photos_recent: { points: 4, label: "A photo from the last 90 days", days: 90 },
  logo: { points: 4, label: "A logo" },
  cover: { points: 4, label: "A cover photo" },
  reply_rate: { points: 9, label: "Replies to reviews (80%+)", good: 0.8, some: 0.5 },
} as const;
export type HealthItemKey = keyof typeof HEALTH_RUBRIC;

export type HealthItem = { key: HealthItemKey; label: string; points: number; max: number };
export type HealthScore = { score: number; items: HealthItem[]; gaps: HealthItemKey[] };

// The special dates that matter in the next few weeks: Christmas Day, Boxing
// Day, New Year's Eve and Day, once December is near (from 1 November).
export function upcomingSpecialDates(now: Date): string[] {
  const y = now.getUTCFullYear();
  if (now.getUTCMonth() < 10) return []; // January to October: not due yet
  return [`${y}-12-25`, `${y}-12-26`, `${y}-12-31`, `${y + 1}-01-01`];
}

const DAY = 86_400_000;

export function scoreProfile(p: ProfileSnapshot, now: Date): HealthScore {
  const R = HEALTH_RUBRIC;
  const items: HealthItem[] = [];
  const add = (key: HealthItemKey, earned: number) => items.push({ key, label: R[key].label, points: Math.round(earned), max: R[key].points });
  const desc = (p.description ?? "").trim();
  add("description", desc ? R.description.points : 0);
  add("description_long", desc.length >= R.description_long.minChars ? R.description_long.points : 0);
  add("primary_category", p.primaryCategory ? R.primary_category.points : 0);
  add("secondary_categories", p.additionalCategories.length ? R.secondary_categories.points : 0);
  add("regular_hours", p.hasRegularHours ? R.regular_hours.points : 0);
  const needed = upcomingSpecialDates(now);
  // Outside the season nothing is due, so it scores in full.
  const haveSpecial = needed.length === 0 || needed.some((d) => p.specialHourDates.includes(d));
  add("special_hours", haveSpecial ? R.special_hours.points : 0);
  add("phone", p.phone ? R.phone.points : 0);
  add("website", p.website ? R.website.points : 0);
  add("menu_link", p.menuLink ? R.menu_link.points : 0);
  const setAttributes = ATTRIBUTE_KEYS.filter((k) => p.attributes[k] !== null && p.attributes[k] !== undefined).length;
  add("attributes", (R.attributes.points * setAttributes) / ATTRIBUTE_KEYS.length);
  add("photos", p.photoCount >= R.photos.good ? R.photos.points : p.photoCount >= R.photos.some ? R.photos.points / 2 : 0);
  const recent = p.latestPhotoAt ? now.getTime() - new Date(p.latestPhotoAt).getTime() <= R.photos_recent.days * DAY : false;
  add("photos_recent", recent ? R.photos_recent.points : 0);
  add("logo", p.hasLogo ? R.logo.points : 0);
  add("cover", p.hasCover ? R.cover.points : 0);
  const rate = p.replyRate;
  add("reply_rate", rate === null ? R.reply_rate.points : rate >= R.reply_rate.good ? R.reply_rate.points : rate >= R.reply_rate.some ? Math.round(R.reply_rate.points / 2) : 0);
  const score = Math.min(100, items.reduce((s, i) => s + i.points, 0));
  return { score, items, gaps: items.filter((i) => i.points < i.max).map((i) => i.key) };
}

export const RUBRIC_TOTAL = Object.values(HEALTH_RUBRIC).reduce((s, i) => s + i.points, 0);
