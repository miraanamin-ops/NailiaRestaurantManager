// Plain-code translations between Google Business Profile's formats and ours:
// reviews, opening hours, special hours, posts, the imported profile and the
// performance numbers. Only type imports, so every rule is unit-tested
// (tests/google-live.test.ts).
import type { Day, Hours } from "@/lib/onboarding/profile-data";

const DAYS: readonly Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const GOOGLE_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type GoogleDay = (typeof GOOGLE_DAYS)[number];

// ---------- Google's shapes (only the fields we use) ----------

export type GTime = { hours?: number; minutes?: number };
export type GDate = { year: number; month: number; day: number };
export type GPeriod = { openDay: GoogleDay; openTime?: GTime; closeDay: GoogleDay; closeTime?: GTime };
export type GSpecialPeriod = { startDate: GDate; endDate?: GDate; openTime?: GTime; closeTime?: GTime; closed?: boolean };

export type GReview = {
  name: string; // accounts/{a}/locations/{l}/reviews/{r}
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string; // "ONE" … "FIVE"
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export type GLocation = {
  name: string; // locations/{l}
  title?: string;
  phoneNumbers?: { primaryPhone?: string };
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string };
  regularHours?: { periods?: GPeriod[] };
  specialHours?: { specialHourPeriods?: GSpecialPeriod[] };
  categories?: { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
  websiteUri?: string;
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string };
};

export type GMedia = { name: string; googleUrl?: string; thumbnailUrl?: string; mediaFormat?: string; locationAssociation?: { category?: string } };

// ---------- Reviews ----------

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const starsOf = (s: string | undefined) => STARS[s ?? ""] ?? null;

// The row a Google review becomes in our `reviews` table. A review without a
// star rating can't be handled like the others (our table needs 1 to 5), so it's left out.
export function reviewRow(restaurantId: string, r: GReview) {
  const rating = starsOf(r.starRating);
  if (!rating) return null;
  return {
    restaurant_id: restaurantId,
    google_review_id: r.reviewId,
    source: "google_live",
    author_name: r.reviewer?.isAnonymous ? "A Google user" : (r.reviewer?.displayName?.trim() || "A Google user"),
    rating,
    text: r.comment?.trim() || null,
    review_date: r.createTime ?? new Date().toISOString(),
    replied: Boolean(r.reviewReply?.comment),
    reply_text: r.reviewReply?.comment ?? null,
    reply_posted_at: r.reviewReply?.updateTime ?? null,
  };
}

// On the first import, which reviews go into the approval queue: only recent
// ones nobody has replied to (the newest few), so connecting doesn't flood the
// owner with drafts for years-old reviews. Everything else counts as seen.
export const IMPORT_QUEUE_MAX = 5;
export const IMPORT_QUEUE_DAYS = 30;
export function reviewsToQueue(reviews: Pick<GReview, "reviewId" | "createTime" | "reviewReply" | "starRating">[], now: Date) {
  const since = now.getTime() - IMPORT_QUEUE_DAYS * 86_400_000;
  return new Set(
    reviews
      .filter((r) => !r.reviewReply?.comment && starsOf(r.starRating) && r.createTime && new Date(r.createTime).getTime() >= since)
      .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
      .slice(0, IMPORT_QUEUE_MAX)
      .map((r) => r.reviewId),
  );
}

// ---------- Opening hours ----------

const pad = (n: number) => String(n).padStart(2, "0");
const timeText = (t: GTime | undefined) => `${pad(t?.hours ?? 0)}:${pad(t?.minutes ?? 0)}`;
const RANGE = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/g;

// "12:00 – 15:00, 17:00 – 23:30" -> [[12,0,15,0], [17,0,23,30]]. Null if it isn't hours (or is "Closed").
export function parseRanges(value: string | undefined): [number, number, number, number][] | null {
  if (!value || /closed/i.test(value)) return null;
  const out = [...value.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number]);
  return out.length && out.every(([h1, m1, h2, m2]) => h1 <= 24 && h2 <= 24 && m1 < 60 && m2 < 60) ? out : null;
}

// Our { Monday: "12:00 – 23:00" } -> Google's periods. A closing time at or before
// the opening time closes the next day ("18:00 – 02:00"); "00:00 – 24:00" is all day.
export function hoursToPeriods(hours: Hours): GPeriod[] {
  const periods: GPeriod[] = [];
  DAYS.forEach((day, i) => {
    for (const [h1, m1, h2, m2] of parseRanges(hours[day]) ?? []) {
      const overnight = h2 * 60 + m2 <= h1 * 60 + m1;
      periods.push({
        openDay: GOOGLE_DAYS[i],
        openTime: { hours: h1, minutes: m1 },
        closeDay: GOOGLE_DAYS[overnight ? (i + 1) % 7 : i],
        closeTime: { hours: h2, minutes: m2 },
      });
    }
  });
  return periods;
}

// Google's periods -> our { Monday: "12:00 – 23:00" }; a day without any is "Closed".
export function periodsToHours(periods: GPeriod[] | undefined): Hours {
  const out: Hours = {};
  if (!periods?.length) return out;
  DAYS.forEach((day, i) => {
    const mine = periods
      .filter((p) => p.openDay === GOOGLE_DAYS[i])
      .sort((a, b) => (a.openTime?.hours ?? 0) * 60 + (a.openTime?.minutes ?? 0) - ((b.openTime?.hours ?? 0) * 60 + (b.openTime?.minutes ?? 0)));
    out[day] = mine.length ? mine.map((p) => `${timeText(p.openTime)} – ${timeText(p.closeTime)}`).join(", ") : "Closed";
  });
  return out;
}

// ---------- Special hours ----------

export type SpecialHours = Record<string, { label?: string | null; hours: string }>; // "2026-12-25" -> { hours: "Closed" }

const gDate = (ymd: string): GDate => {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
};
const ymdOf = (d: GDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Our special hours -> Google's. Days before `today` are left out (Google
// refuses past dates). Closed = closed all day; otherwise one period per range.
export function specialToGoogle(special: SpecialHours | null | undefined, today: string): GSpecialPeriod[] {
  const out: GSpecialPeriod[] = [];
  for (const [date, v] of Object.entries(special ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;
    const ranges = parseRanges(v?.hours);
    if (!ranges) {
      if (/closed/i.test(v?.hours ?? "")) out.push({ startDate: gDate(date), closed: true });
      continue;
    }
    for (const [h1, m1, h2, m2] of ranges) {
      const overnight = h2 * 60 + m2 <= h1 * 60 + m1;
      out.push({ startDate: gDate(date), openTime: { hours: h1, minutes: m1 }, endDate: gDate(overnight ? nextDay(date) : date), closeTime: { hours: h2, minutes: m2 } });
    }
  }
  return out;
}

// Google's special hours -> ours.
export function specialFromGoogle(periods: GSpecialPeriod[] | undefined): SpecialHours {
  const out: SpecialHours = {};
  for (const p of periods ?? []) {
    const date = ymdOf(p.startDate);
    if (p.closed) out[date] = { hours: "Closed" };
    else {
      const range = `${timeText(p.openTime)} – ${timeText(p.closeTime)}`;
      out[date] = { hours: out[date] && out[date].hours !== "Closed" ? `${out[date].hours}, ${range}` : range };
    }
  }
  return out;
}

// ---------- Posts and photos ----------

export const POST_MAX_CHARS = 1500;

// A Google post. Every post is a "What's new" (STANDARD) post: offers and events
// need dates and titles Google insists on, which our drafts don't have yet.
export function localPostBody(post: { text: string; photo_url: string | null }) {
  return {
    languageCode: "en-GB",
    summary: post.text.slice(0, POST_MAX_CHARS),
    topicType: "STANDARD",
    ...(post.photo_url ? { media: [{ mediaFormat: "PHOTO", sourceUrl: post.photo_url }] } : {}),
  };
}

// Same wording = the same post (how a retried job finds a post it already made).
export const samePostText = (a: string | undefined, b: string) => (a ?? "").trim().slice(0, POST_MAX_CHARS) === b.trim().slice(0, POST_MAX_CHARS);

// ---------- The imported profile ----------

export type GoogleImport = {
  location: string;
  title: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  hours: Hours;
  special_hours: SpecialHours;
  categories: string[];
  place_id: string | null;
  maps_url: string | null;
  review_url: string | null;
  photos: string[];
  reviews: { count: number; queued: number };
};

export function addressText(a: GLocation["storefrontAddress"]) {
  if (!a) return null;
  const parts = [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function importFromLocation(loc: GLocation, media: GMedia[], reviews: { count: number; queued: number }): GoogleImport {
  const cats = [loc.categories?.primaryCategory?.displayName, ...(loc.categories?.additionalCategories ?? []).map((c) => c.displayName)].filter((c): c is string => Boolean(c));
  return {
    location: loc.name,
    title: loc.title ?? null,
    address: addressText(loc.storefrontAddress),
    phone: loc.phoneNumbers?.primaryPhone ?? null,
    website: loc.websiteUri ?? null,
    hours: periodsToHours(loc.regularHours?.periods),
    special_hours: specialFromGoogle(loc.specialHours?.specialHourPeriods),
    categories: cats,
    place_id: loc.metadata?.placeId ?? null,
    maps_url: loc.metadata?.mapsUri ?? null,
    review_url: loc.metadata?.newReviewUri ?? null,
    photos: media.filter((m) => (m.mediaFormat ?? "PHOTO") === "PHOTO" && m.googleUrl).map((m) => m.googleUrl!).slice(0, 10),
    reviews,
  };
}

type ProfileNow = { address?: string | null; phone?: string | null; website?: string | null; cuisine?: string | null; opening_hours?: Record<string, string> | null; special_hours?: SpecialHours | null; photos?: string[] | null; google_place_id?: string | null };
const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

// What an import fills in on the restaurant: only fields that are still empty,
// so it never overwrites anything the owner has already set. Onboarding uses
// this to prefill; connecting an existing restaurant only fills its gaps.
export function prefillFromImport(current: ProfileNow, g: GoogleImport) {
  const want = {
    address: g.address,
    phone: g.phone,
    website: g.website,
    cuisine: g.categories[0] ?? null,
    opening_hours: Object.keys(g.hours).length ? g.hours : null,
    special_hours: Object.keys(g.special_hours).length ? g.special_hours : null,
    photos: g.photos.length ? g.photos.slice(0, 3) : null,
    google_place_id: g.place_id,
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) if (!empty(v) && empty(current[k as keyof ProfileNow])) out[k] = v;
  return out as Partial<ProfileNow>;
}

// ---------- Performance ----------

export const PERFORMANCE_METRICS = {
  views: ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"],
  calls: ["CALL_CLICKS"],
  directions: ["BUSINESS_DIRECTION_REQUESTS"],
  websiteClicks: ["WEBSITE_CLICKS"],
} as const;
export type Performance = { views: number; calls: number; directions: number; websiteClicks: number };

type GSeries = { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string }[] } };
// fetchMultiDailyMetricsTimeSeries' answer -> totals for the period.
export function sumPerformance(res: { multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: GSeries[] }[] }): Performance {
  const totals: Record<string, number> = {};
  for (const group of res.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      const sum = (s.timeSeries?.datedValues ?? []).reduce((n, v) => n + (Number(v.value) || 0), 0);
      totals[s.dailyMetric ?? ""] = (totals[s.dailyMetric ?? ""] ?? 0) + sum;
    }
  }
  const of = (names: readonly string[]) => names.reduce((n, m) => n + (totals[m] ?? 0), 0);
  return { views: of(PERFORMANCE_METRICS.views), calls: of(PERFORMANCE_METRICS.calls), directions: of(PERFORMANCE_METRICS.directions), websiteClicks: of(PERFORMANCE_METRICS.websiteClicks) };
}

// The query string for a date range (inclusive dates, Google's own format).
export function performanceQuery(start: string, endInclusive: string) {
  const p = new URLSearchParams();
  for (const m of Object.values(PERFORMANCE_METRICS).flat()) p.append("dailyMetrics", m);
  const [s, e] = [gDate(start), gDate(endInclusive)];
  p.set("dailyRange.start_date.year", String(s.year));
  p.set("dailyRange.start_date.month", String(s.month));
  p.set("dailyRange.start_date.day", String(s.day));
  p.set("dailyRange.end_date.year", String(e.year));
  p.set("dailyRange.end_date.month", String(e.month));
  p.set("dailyRange.end_date.day", String(e.day));
  return p.toString();
}

// ---------- Retries ----------

// Rate limits and Google's own hiccups are worth another go; anything else isn't.
export const retryable = (status: number) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

// How long to wait before attempt n+1 (n from 1): Retry-After if Google gave
// one (capped), else 1s, 2s, 4s… plus up to 250ms of jitter.
export function backoffMs(attempt: number, retryAfter: string | null, random = Math.random()) {
  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  if (seconds !== null) return Math.min(seconds * 1000, 10_000);
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(random * 250);
}
