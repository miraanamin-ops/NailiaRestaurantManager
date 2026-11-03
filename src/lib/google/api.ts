import "server-only";
import { dryRunContext, googleWriteRefused } from "@/lib/gate-rules";
import type { Restaurant } from "@/lib/supabase";
import { accessToken, loginBroken, type GoogleConnection, type GoogleLink } from "./connections";
import { backoffMs, performanceQuery, retryable, type GLocation, type GMedia, type GPeriod, type GReview, type GSpecialPeriod } from "./mapping";
import { GoogleAuthError } from "./oauth";

// The Google Business Profile APIs, one function per call we make. Every call
// goes through gbp(): a fresh access token, and retries with backoff for rate
// limits (429) and Google's own errors (5xx). Tested against a mocked fetch
// (tests/google-live.test.ts).

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const PERF = "https://businessprofileperformance.googleapis.com/v1";
const MAX_ATTEMPTS = 4;

// Google said no, and trying again won't change that (bad request, no permission, not found).
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

// Tests swap this for an instant one.
export const retryTiming = { wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

export async function gbp<T>(conn: GoogleConnection, method: string, url: string, body?: unknown, restaurant?: Restaurant | null): Promise<T> {
  const refused = googleWriteRefused(method, restaurant, url, dryRunContext(process.env));
  if (refused) throw new GoogleApiError(refused, 403);
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken(conn, restaurant);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // The network or a timeout: worth another go.
      if (attempt >= MAX_ATTEMPTS) throw err;
      await retryTiming.wait(backoffMs(attempt, null));
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // An access token Google rejects: get a new one once, then give up.
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      conn.access_expires_at = null;
      continue;
    }
    if (res.status === 401) {
      const err = new GoogleAuthError(`Google rejected the login (401): ${detail}`);
      await loginBroken(conn, err.message, restaurant ?? null);
      throw err;
    }
    if (retryable(res.status) && attempt < MAX_ATTEMPTS) {
      await retryTiming.wait(backoffMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw new GoogleApiError(`Google ${method} ${new URL(url).pathname} failed (${res.status}): ${detail}`, res.status);
  }
}

// ---------- Accounts and locations (the location picker) ----------

export type GAccount = { name: string; accountName?: string; type?: string };

export async function listAccounts(conn: GoogleConnection) {
  const out: GAccount[] = [];
  let pageToken = "";
  do {
    const res = await gbp<{ accounts?: GAccount[]; nextPageToken?: string }>(conn, "GET", `${ACCOUNTS}/accounts?pageSize=20${pageToken ? `&pageToken=${pageToken}` : ""}`);
    out.push(...(res.accounts ?? []));
    pageToken = res.nextPageToken ?? "";
  } while (pageToken && out.length < 200);
  return out;
}

export async function listLocations(conn: GoogleConnection, accountId: string) {
  const out: GLocation[] = [];
  let pageToken = "";
  do {
    const res = await gbp<{ locations?: GLocation[]; nextPageToken?: string }>(
      conn,
      "GET",
      `${INFO}/${accountId}/locations?readMask=name,title,storefrontAddress&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    out.push(...(res.locations ?? []));
    pageToken = res.nextPageToken ?? "";
  } while (pageToken && out.length < 500);
  return out;
}

// ---------- Manager invitations (our manager account, lib/google/invitations.ts) ----------

export type GInvitation = {
  name: string; // accounts/{a}/invitations/{i}
  role?: string;
  targetType?: string;
  targetLocation?: { locationName?: string; address?: string };
  targetAccount?: { accountName?: string };
};

// The invitations waiting for one of our accounts (its own, personal account).
export async function listInvitations(conn: GoogleConnection, accountName: string) {
  const res = await gbp<{ invitations?: GInvitation[] }>(conn, "GET", `${ACCOUNTS}/${accountName}/invitations`);
  return res.invitations ?? [];
}

export const acceptInvitation = (conn: GoogleConnection, invitationName: string) => gbp<object>(conn, "POST", `${ACCOUNTS}/${invitationName}:accept`, {});

// ---------- The profile ----------

const PROFILE_MASK = "name,title,phoneNumbers,storefrontAddress,regularHours,specialHours,categories,websiteUri,metadata";

export const getLocation = (link: GoogleLink) => gbp<GLocation>(link.connection, "GET", `${INFO}/${link.locationId}?readMask=${PROFILE_MASK}`, undefined, link.restaurant);

export const updateHours = (link: GoogleLink, hours: { regular: GPeriod[]; special: GSpecialPeriod[] }) =>
  gbp<GLocation>(
    link.connection,
    "PATCH",
    `${INFO}/${link.locationId}?updateMask=regularHours,specialHours`,
    { regularHours: { periods: hours.regular }, specialHours: { specialHourPeriods: hours.special } },
    link.restaurant,
  );

// The profile in full, for the business review's health check (lib/review/google-profile.ts).
export type GProfileLocation = GLocation & { profile?: { description?: string } };
export const getProfileLocation = (link: GoogleLink) =>
  gbp<GProfileLocation>(link.connection, "GET", `${INFO}/${link.locationId}?readMask=name,title,phoneNumbers,regularHours,specialHours,categories,websiteUri,profile,metadata`, undefined, link.restaurant);

export type GAttribute = { name: string; valueType?: string; values?: unknown[]; uriValues?: { uri: string }[] };
export type GAttributeMeta = { parent: string; valueType?: string; displayName?: string; groupDisplayName?: string; deprecated?: boolean };

// The attributes set on the location (halal, parking, the menu link...).
export async function getAttributes(link: GoogleLink) {
  const res = await gbp<{ attributes?: GAttribute[] }>(link.connection, "GET", `${INFO}/${link.locationId}/attributes`, undefined, link.restaurant);
  return res.attributes ?? [];
}

// The attributes this location's category can have (their ids come from here, never guessed).
export async function attributeMetadata(link: GoogleLink) {
  const res = await gbp<{ attributeMetadata?: GAttributeMeta[] }>(
    link.connection,
    "GET",
    `${INFO}/attributes?parent=${link.locationId}&languageCode=en&regionCode=GB&pageSize=200`,
    undefined,
    link.restaurant,
  );
  return res.attributeMetadata ?? [];
}

// Fills (or, for UNDO, clears) the named fields: updateMask says which.
export const patchProfile = (link: GoogleLink, body: Record<string, unknown>, mask: string[]) =>
  gbp<GLocation>(link.connection, "PATCH", `${INFO}/${link.locationId}?updateMask=${mask.join(",")}`, body, link.restaurant);

// Sets (or, left without values, unsets) the named attributes.
export const patchAttributes = (link: GoogleLink, attributes: GAttribute[], mask: string[]) =>
  gbp<{ attributes?: GAttribute[] }>(
    link.connection,
    "PATCH",
    `${INFO}/${link.locationId}/attributes?attributeMask=${mask.join(",")}`,
    { name: `${link.locationId}/attributes`, attributes },
    link.restaurant,
  );

// ---------- Reviews (v4) ----------

const v4Location = (link: GoogleLink) => `${V4}/${link.accountId}/${link.locationId}`;

// The newest reviews (up to `max`), newest first.
export async function listReviews(link: GoogleLink, max = 50) {
  const out: GReview[] = [];
  let pageToken = "";
  let total = 0;
  let average: number | null = null;
  do {
    const res = await gbp<{ reviews?: GReview[]; nextPageToken?: string; totalReviewCount?: number; averageRating?: number }>(
      link.connection,
      "GET",
      `${v4Location(link)}/reviews?pageSize=${Math.min(50, max)}&orderBy=updateTime%20desc${pageToken ? `&pageToken=${pageToken}` : ""}`,
      undefined,
      link.restaurant,
    );
    out.push(...(res.reviews ?? []));
    total = res.totalReviewCount ?? total;
    average = typeof res.averageRating === "number" ? res.averageRating : average;
    pageToken = res.nextPageToken ?? "";
  } while (pageToken && out.length < max);
  return { reviews: out.slice(0, max), total, average };
}

export const putReply = (link: GoogleLink, reviewId: string, comment: string) =>
  gbp<{ comment: string; updateTime: string }>(link.connection, "PUT", `${v4Location(link)}/reviews/${reviewId}/reply`, { comment }, link.restaurant);

export const deleteReply = (link: GoogleLink, reviewId: string) => gbp<object>(link.connection, "DELETE", `${v4Location(link)}/reviews/${reviewId}/reply`, undefined, link.restaurant);

// ---------- Posts and photos (v4) ----------

export type GLocalPost = { name: string; summary?: string; searchUrl?: string; state?: string; createTime?: string };

export const createLocalPost = (link: GoogleLink, body: object) => gbp<GLocalPost>(link.connection, "POST", `${v4Location(link)}/localPosts`, body, link.restaurant);

// post: the full name "accounts/…/locations/…/localPosts/…".
export const deleteLocalPost = (link: GoogleLink, post: string) => gbp<object>(link.connection, "DELETE", `${V4}/${post}`, undefined, link.restaurant);

export async function listLocalPosts(link: GoogleLink, max = 20) {
  const res = await gbp<{ localPosts?: GLocalPost[] }>(link.connection, "GET", `${v4Location(link)}/localPosts?pageSize=${Math.min(100, max)}`, undefined, link.restaurant);
  return res.localPosts ?? [];
}

export const createMedia = (link: GoogleLink, sourceUrl: string, category = "ADDITIONAL") =>
  gbp<GMedia>(link.connection, "POST", `${v4Location(link)}/media`, { mediaFormat: "PHOTO", locationAssociation: { category }, sourceUrl }, link.restaurant);

// media: the full name "accounts/…/locations/…/media/…" (UNDO of a logo upload).
export const deleteMedia = (link: GoogleLink, media: string) => gbp<object>(link.connection, "DELETE", `${V4}/${media}`, undefined, link.restaurant);

export async function listMedia(link: GoogleLink, max = 20) {
  const res = await gbp<{ mediaItems?: GMedia[] }>(link.connection, "GET", `${v4Location(link)}/media?pageSize=${Math.min(100, max)}`, undefined, link.restaurant);
  return res.mediaItems ?? [];
}

// ---------- Performance ----------

export const fetchPerformance = (link: GoogleLink, start: string, endInclusive: string) =>
  gbp<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string }[] } }[] }[] }>(
    link.connection,
    "GET",
    `${PERF}/${link.locationId}:fetchMultiDailyMetricsTimeSeries?${performanceQuery(start, endInclusive)}`,
    undefined,
    link.restaurant,
  );
