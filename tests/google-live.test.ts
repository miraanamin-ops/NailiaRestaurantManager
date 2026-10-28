// Live Google, against a mocked Google API: reviews copied in once, replies and
// posts written exactly once per job (even when a job runs twice), retries with
// backoff for rate limits, a login Google stops accepting (owner told once a
// day, builder alerted), dummy Google kept for restaurants that haven't linked a
// location, and a failed write put back for a retry instead of counted as sent.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import {
  backoffMs,
  hoursToPeriods,
  localPostBody,
  periodsToHours,
  prefillFromImport,
  reviewRow,
  reviewsToQueue,
  specialFromGoogle,
  specialToGoogle,
  sumPerformance,
  type GReview,
} from "@/lib/google/mapping";

const R = "aaaaaaaa-0000-0000-0000-000000000001"; // linked to Google
const DEMO = "bbbbbbbb-0000-0000-0000-000000000002"; // not linked: dummy Google
const CONN = "cccccccc-0000-0000-0000-00000000000c";
const NOON_UK = new Date("2026-10-26T12:00:00Z");

// ---------- Pure rules ----------

describe("translating Google's formats", () => {
  test("opening hours go to Google and back, including after midnight and closed days", () => {
    const hours = { Monday: "Closed", Tuesday: "12:00 – 15:00, 17:00 – 23:00", Friday: "18:00 – 02:00", Sunday: "00:00 – 24:00" };
    const periods = hoursToPeriods(hours);
    expect(periods).toContainEqual({ openDay: "FRIDAY", openTime: { hours: 18, minutes: 0 }, closeDay: "SATURDAY", closeTime: { hours: 2, minutes: 0 } });
    expect(periods.filter((p) => p.openDay === "TUESDAY")).toHaveLength(2);
    expect(periods.some((p) => p.openDay === "MONDAY")).toBe(false);
    const back = periodsToHours(periods);
    expect(back).toMatchObject({ Monday: "Closed", Tuesday: "12:00 – 15:00, 17:00 – 23:00", Friday: "18:00 – 02:00", Sunday: "00:00 – 24:00", Wednesday: "Closed" });
  });

  test("special hours: past days are left out, closed days and late finishes are Google's way", () => {
    const special = { "2026-10-01": { hours: "Closed" }, "2026-12-25": { label: "Christmas", hours: "Closed" }, "2026-12-31": { hours: "18:00 – 01:00" } };
    const g = specialToGoogle(special, "2026-10-26");
    expect(g).toEqual([
      { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
      { startDate: { year: 2026, month: 12, day: 31 }, openTime: { hours: 18, minutes: 0 }, endDate: { year: 2027, month: 1, day: 1 }, closeTime: { hours: 1, minutes: 0 } },
    ]);
    expect(specialFromGoogle(g)).toEqual({ "2026-12-25": { hours: "Closed" }, "2026-12-31": { hours: "18:00 – 01:00" } });
  });

  test("a review becomes our row; anonymous reviewers and missing ratings are handled", () => {
    const r: GReview = { name: "accounts/1/locations/2/reviews/x", reviewId: "x", reviewer: { isAnonymous: true, displayName: "Secret" }, starRating: "FOUR", comment: " Great lamb ", createTime: "2026-10-20T10:00:00Z" };
    expect(reviewRow(R, r)).toMatchObject({ restaurant_id: R, google_review_id: "x", source: "google_live", author_name: "A Google user", rating: 4, text: "Great lamb", replied: false });
    expect(reviewRow(R, { ...r, starRating: "STAR_RATING_UNSPECIFIED" })).toBeNull();
    expect(reviewRow(R, { ...r, reviewReply: { comment: "Thanks!", updateTime: "2026-10-21T00:00:00Z" } })).toMatchObject({ replied: true, reply_text: "Thanks!" });
  });

  test("on connect only the newest few recent unreplied reviews go to the queue", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const mk = (id: string, daysAgo: number, replied = false): GReview => ({ name: id, reviewId: id, starRating: "FIVE", createTime: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), ...(replied ? { reviewReply: { comment: "hi" } } : {}) });
    const reviews = [mk("old", 90), mk("replied", 1, true), ...Array.from({ length: 7 }, (_, i) => mk(`r${i}`, i + 1))];
    const keep = reviewsToQueue(reviews, now);
    expect(keep.size).toBe(5);
    expect(keep.has("r0") && keep.has("r4")).toBe(true);
    expect(keep.has("r6") || keep.has("old") || keep.has("replied")).toBe(false);
  });

  test("performance totals, posts and backoff", () => {
    const res = {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "3" }, { value: "2" }, {}] } },
            { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [{ value: "100" }] } },
            { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", timeSeries: { datedValues: [{ value: "20" }] } },
            { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "7" }] } },
          ],
        },
      ],
    };
    expect(sumPerformance(res)).toEqual({ views: 120, calls: 5, directions: 0, websiteClicks: 7 });
    expect(localPostBody({ text: "Hello", photo_url: "https://x/p.jpg" })).toMatchObject({ topicType: "STANDARD", summary: "Hello", media: [{ mediaFormat: "PHOTO", sourceUrl: "https://x/p.jpg" }] });
    expect(backoffMs(1, null, 0)).toBe(1000);
    expect(backoffMs(3, null, 0)).toBe(4000);
    expect(backoffMs(1, "3")).toBe(3000);
    expect(backoffMs(1, "600")).toBe(10_000);
  });

  test("an import only fills fields that are still empty", () => {
    const g = { location: "locations/2", title: "Ember", address: "1 High St", phone: "+44 20", website: "https://e.test", hours: { Monday: "12:00 – 22:00" }, special_hours: {}, categories: ["Grill"], place_id: "pl", maps_url: null, review_url: null, photos: ["https://p/1"], reviews: { count: 1, queued: 0 } };
    expect(prefillFromImport({ address: "Mine", phone: null, website: "", opening_hours: {}, cuisine: "Halal grill", photos: [] }, g)).toEqual({
      phone: "+44 20",
      website: "https://e.test",
      opening_hours: { Monday: "12:00 – 22:00" },
      photos: ["https://p/1"],
      google_place_id: "pl",
    });
  });
});

// ---------- Against the mocked API ----------

type Handler = (req: { method: string; url: URL; body: unknown }) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined;

let db: ReturnType<typeof memoryDb>;
let calls: { method: string; path: string; body: unknown }[];
let handler: Handler;
let ownerMessages: string[];
let builderAlerts: string[];

const restaurant = (id: string, extra: Record<string, unknown>) => ({
  id,
  name: id === R ? "Ember & Spice Grill" : "Demo Diner",
  slug: id === R ? "ember-spice" : "demo",
  owner_whatsapp: "whatsapp:+447700900111",
  whatsapp_from: "whatsapp:+14155238886",
  opening_hours: { Monday: "12:00 – 22:00", Friday: "18:00 – 02:00" },
  special_hours: { "2026-12-25": { hours: "Closed" } },
  menu: [],
  discount_cap_percent: 20,
  send_window_start: "09:00:00",
  send_window_end: "21:00:00",
  paused: false,
  fake_now: null,
  active: true,
  is_demo: false,
  trust_levels: {},
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// Google as it answers when everything works; tests override `handler` per case.
const google: Handler = ({ method, url }) => {
  const p = url.pathname;
  if (p === "/token") return { json: { access_token: "fresh-access", expires_in: 3600, token_type: "Bearer" } };
  if (method === "GET" && p.endsWith("/reviews"))
    return {
      json: {
        totalReviewCount: 2,
        reviews: [
          { name: "accounts/1/locations/2/reviews/g1", reviewId: "g1", reviewer: { displayName: "Aisha" }, starRating: "FIVE", comment: "Best lamb chops", createTime: "2026-10-25T10:00:00Z" },
          { name: "accounts/1/locations/2/reviews/g2", reviewId: "g2", reviewer: { displayName: "Omar" }, starRating: "TWO", comment: "Slow", createTime: "2026-10-24T10:00:00Z", reviewReply: { comment: "Sorry Omar", updateTime: "2026-10-24T12:00:00Z" } },
        ],
      },
    };
  if (method === "PUT" && p.endsWith("/reply")) return { json: { comment: "x", updateTime: "2026-10-26T12:00:00Z" } };
  if (method === "DELETE") return { json: {} };
  if (method === "POST" && p.endsWith("/localPosts")) return { json: { name: "accounts/1/locations/2/localPosts/p9", searchUrl: "https://g.co/post/p9" } };
  if (method === "GET" && p.endsWith("/localPosts")) return { json: { localPosts: [] } };
  if (method === "PATCH") return { json: { name: "locations/2" } };
  if (p.includes(":fetchMultiDailyMetricsTimeSeries")) return { json: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "4" }] } }] }] } };
  return undefined;
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_MODE", "live");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("TEST_MODE", "");
  vi.stubEnv("APP_URL", "https://app.dinerai.co.uk");
  const { encryptToken } = await import("@/lib/google/crypto");
  db = memoryDb(
    {
      restaurants: [
        restaurant(R, { google_connection_id: CONN, google_account_id: "accounts/1", google_location_id: "locations/2", google_location_title: "Ember & Spice Grill", google_imported_at: "2026-10-20T00:00:00Z" }),
        restaurant(DEMO, { is_demo: true }),
      ],
      google_connections: [
        {
          id: CONN, restaurant_id: R, kind: "owner", google_email: "owner@gmail.test", google_sub: "sub-1", status: "ok", reconnect_sent_on: null, last_error: null,
          refresh_token_enc: encryptToken("refresh-1"), access_token_enc: encryptToken("old-access"), access_expires_at: "2026-01-01T00:00:00Z", created_at: "2026-10-20T00:00:00Z",
        },
      ],
      reviews: [],
      google_posts: [],
      google_writes: [],
      drafts: [],
      sent_log: [],
      audit_log: [],
      blocked_sends: [],
      builder_alerts: [],
    },
    { unique: ["google_writes.key"] },
  );
  calls = [];
  handler = google;
  ownerMessages = [];
  builderAlerts = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (url.pathname === "/token" ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)) : (init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined);
    calls.push({ method, path: url.pathname, body });
    const out = handler({ method, url, body }) ?? google({ method, url, body });
    if (!out) return json(404, { error: { message: `no mock for ${method} ${url}` } });
    return json(out.status ?? 200, out.json, out.headers);
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void ownerMessages.push(text) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (builderAlerts.push(m), "sent") }));
  const { retryTiming } = await import("@/lib/google/api");
  retryTiming.wait = async () => {};
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/notify");
  vi.doUnmock("@/lib/builder-alerts");
});

const googleCalls = (method: string, ending: string) => calls.filter((c) => c.method === method && c.path.endsWith(ending));

describe("which Google a restaurant uses", () => {
  test("a linked restaurant is live; one without a location stays dummy, and GOOGLE_MODE=dummy wins", async () => {
    const { googleModeFor } = await import("@/lib/google");
    expect(await googleModeFor(R)).toBe("live");
    expect(await googleModeFor(DEMO)).toBe("dummy");
    vi.stubEnv("GOOGLE_MODE", "dummy");
    expect(await googleModeFor(R)).toBe("dummy");
  });
});

describe("test sites never write to live Google", () => {
  const makeTestSite = () => Object.assign(db.tables.restaurants.find((r) => r.id === R)!, { is_demo: true, is_test: true });

  test("a linked test site counts as simulated: it reads Google, and every write is refused before Google is called", async () => {
    makeTestSite();
    const { google, googleFor, googleModeFor } = await import("@/lib/google");
    expect(await googleModeFor(R)).toBe("simulated");
    // Reading is fine (the tone step needs real reviews).
    await google().claimNewReviews(R);
    const review = db.tables.reviews.find((r) => r.google_review_id === "g1")!;
    const writes = () => calls.filter((c) => c.method !== "GET" && c.path !== "/token");

    await expect(google().replyToReview(R, String(review.id), "Thank you!")).rejects.toThrow(/Test sites never write to live Google/);
    await expect(google().publishPost(R, { id: "post-1", topic: "update", text: "Lamb chops are back", photo_url: null } as never)).rejects.toThrow(/Test sites/);
    await expect((await googleFor(R)).updateHours!(R, "job-1")).rejects.toThrow(/Test sites/);
    await expect(google().removeReply(R, String(review.id))).rejects.toThrow(/Test sites/);
    expect(writes()).toEqual([]);
  });

  test("a write that doesn't name its restaurant is refused", async () => {
    const { gbp } = await import("@/lib/google/api");
    const { getConnection } = await import("@/lib/google/connections");
    const conn = (await getConnection(CONN))!;
    await expect(gbp(conn, "POST", "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts", {})).rejects.toThrow(/must say which restaurant/);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/localPosts"))).toEqual([]);
  });
});

describe("reviews", () => {
  test("new Google reviews are copied in once and claimed; ones already replied to count as handled", async () => {
    const { google } = await import("@/lib/google");
    const claimed = await google().claimNewReviews(R);
    expect(claimed.map((r) => r.author_name)).toEqual(["Aisha"]);
    expect(db.tables.reviews).toHaveLength(2);
    expect(db.tables.reviews.find((r) => r.google_review_id === "g2")).toMatchObject({ replied: true, reply_text: "Sorry Omar" });
    expect(db.tables.reviews.find((r) => r.google_review_id === "g2")?.handled_at).toBeTruthy();
    // The old access token had expired: one refresh, with our refresh token.
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(1);
    expect(calls.find((c) => c.path === "/token")?.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });

    // The next check: no duplicates, and the claimed review isn't handed out again.
    await google().markReviewHandled(claimed[0].id);
    expect(await google().claimNewReviews(R)).toEqual([]);
    expect(db.tables.reviews).toHaveLength(2);
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(1); // the new token was kept
  });

  test("a reply is posted once, even if the same job runs twice; UNDO deletes it and lets it post again", async () => {
    const { google } = await import("@/lib/google");
    await google().claimNewReviews(R);
    const review = db.tables.reviews.find((r) => r.google_review_id === "g1")!;
    await google().replyToReview(R, String(review.id), "Thank you Aisha!");
    await google().replyToReview(R, String(review.id), "Thank you Aisha!");
    expect(googleCalls("PUT", "/reviews/g1/reply")).toHaveLength(1);
    expect(googleCalls("PUT", "/reviews/g1/reply")[0].body).toEqual({ comment: "Thank you Aisha!" });
    expect(db.tables.reviews.find((r) => r.id === review.id)).toMatchObject({ replied: true, reply_text: "Thank you Aisha!" });

    await google().removeReply(R, String(review.id));
    expect(googleCalls("DELETE", "/reviews/g1/reply")).toHaveLength(1);
    expect(db.tables.reviews.find((r) => r.id === review.id)).toMatchObject({ replied: false, reply_text: null });
    await google().replyToReview(R, String(review.id), "Thank you Aisha!");
    expect(googleCalls("PUT", "/reviews/g1/reply")).toHaveLength(2);
  });

  test("rate limits are retried with backoff (Retry-After respected)", async () => {
    const waits: number[] = [];
    const { retryTiming } = await import("@/lib/google/api");
    retryTiming.wait = async (ms) => void waits.push(ms);
    let n = 0;
    handler = ({ method, url }) => (method === "GET" && url.pathname.endsWith("/reviews") && n++ < 2 ? { status: 429, json: { error: "slow down" }, headers: { "retry-after": "2" } } : undefined);
    const { google } = await import("@/lib/google");
    await google().claimNewReviews(R);
    expect(googleCalls("GET", "/reviews")).toHaveLength(3);
    expect(waits).toEqual([2000, 2000]);
    expect(db.tables.reviews).toHaveLength(2);
  });
});

describe("posts, hours and performance", () => {
  const post = { id: "post-1", topic: "update" as const, text: "Lamb chops are back this weekend", photo_url: "https://cdn.test/lamb.jpg" };

  test("a post is created once per job; a job that died after Google made it finds it instead of posting again", async () => {
    db.tables.google_posts.push({ ...post, restaurant_id: R, published_at: null, google_post_id: null });
    const { google } = await import("@/lib/google");
    expect(await google().publishPost(R, post)).toEqual({ googlePostId: "accounts/1/locations/2/localPosts/p9" });
    await google().publishPost(R, post);
    expect(googleCalls("POST", "/localPosts")).toHaveLength(1);
    expect(googleCalls("POST", "/localPosts")[0].body).toMatchObject({ summary: post.text, media: [{ sourceUrl: post.photo_url }] });
    expect(db.tables.google_posts[0]).toMatchObject({ google_post_id: "accounts/1/locations/2/localPosts/p9", google_url: "https://g.co/post/p9" });

    // Another job: a run that died mid-way (pending, long ago) and Google has the post.
    db.tables.google_writes.push({ id: "w2", restaurant_id: R, key: "post:post-2", action: "post", status: "pending", attempts: 1, updated_at: "2026-10-26T00:00:00Z" });
    db.tables.google_posts.push({ ...post, id: "post-2", text: "Dessert night", restaurant_id: R, published_at: null, google_post_id: null });
    handler = ({ method, url }) => (method === "GET" && url.pathname.endsWith("/localPosts") ? { json: { localPosts: [{ name: "accounts/1/locations/2/localPosts/p10", summary: "Dessert night" }] } } : undefined);
    expect(await google().publishPost(R, { ...post, id: "post-2", text: "Dessert night" })).toEqual({ googlePostId: "accounts/1/locations/2/localPosts/p10" });
    expect(googleCalls("POST", "/localPosts")).toHaveLength(1);
    expect(db.tables.google_writes.find((w) => w.key === "post:post-2")).toMatchObject({ status: "done" });

    // UNDO: deleted on Google.
    const { liveGoogle } = await import("@/lib/google/live");
    await liveGoogle.unpublishPost(R, "post-1");
    expect(googleCalls("DELETE", "/localPosts/p9")).toHaveLength(1);
    expect(db.tables.google_posts[0]).toMatchObject({ published_at: null });
  });

  test("hours and special hours are written to Google once per job", async () => {
    const { liveGoogle } = await import("@/lib/google/live");
    await liveGoogle.updateHours!(R, "draft-h1");
    await liveGoogle.updateHours!(R, "draft-h1");
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("/v1/locations/2");
    const body = patches[0].body as { regularHours: { periods: unknown[] }; specialHours: { specialHourPeriods: unknown[] } };
    expect(body.regularHours.periods).toContainEqual({ openDay: "FRIDAY", openTime: { hours: 18, minutes: 0 }, closeDay: "SATURDAY", closeTime: { hours: 2, minutes: 0 } });
    expect(body.specialHours.specialHourPeriods).toEqual([{ startDate: { year: 2026, month: 12, day: 25 }, closed: true }]);
  });

  test("performance numbers are read for the period", async () => {
    const { liveGoogle } = await import("@/lib/google/live");
    expect(await liveGoogle.getInsights!(R, new Date("2026-10-19T00:00:00Z"), new Date("2026-10-26T00:00:00Z"))).toEqual({ views: 0, calls: 4, directions: 0, websiteClicks: 0 });
    const call = calls.find((c) => c.path.includes(":fetchMultiDailyMetricsTimeSeries"))!;
    expect(call.path).toBe("/v1/locations/2:fetchMultiDailyMetricsTimeSeries");
  });
});

describe("token health", () => {
  test("a refresh Google refuses flags the login, alerts the builder, and sends the owner one reconnect link a day", async () => {
    handler = ({ url }) => (url.pathname === "/token" ? { status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } : undefined);
    const { google } = await import("@/lib/google");
    // The hourly check doesn't fail over it.
    await expect(google().claimNewReviews(R)).resolves.toEqual([]);
    expect(db.tables.google_connections[0]).toMatchObject({ status: "needs_reconnect" });
    expect(builderAlerts[0]).toMatch(/stopped working/);
    expect(ownerMessages).toHaveLength(1);
    expect(ownerMessages[0]).toContain(`https://app.dinerai.co.uk/settings/google?r=${R}`);

    // Same day again (e.g. a reply): no second message, no more refresh attempts.
    db.tables.google_connections[0].status = "ok";
    db.tables.google_connections[0].access_expires_at = null;
    await expect(google().replyToReview(R, "x", "hi")).resolves.toBeUndefined(); // no such live review: dummy path
    const { liveGoogle } = await import("@/lib/google/live");
    await expect(liveGoogle.updateHours!(R, "d")).rejects.toThrow(/refused the login/);
    expect(ownerMessages).toHaveLength(1);
  });

  test("an approved reply that Google won't take now is held for a retry, not counted as sent; one Google refuses is blocked", async () => {
    const { google } = await import("@/lib/google");
    await google().claimNewReviews(R);
    const review = db.tables.reviews.find((r) => r.google_review_id === "g1")!;
    const draft = { id: "d1", restaurant_id: R, kind: "review_reply", review_id: review.id, content: "Thank you Aisha!", audience: "Google review by Aisha", status: "approved", approved_at: "2026-10-26T11:00:00Z", sent_at: null, scheduled_for: null, version: 1, checks: {}, customer_id: null };
    db.tables.drafts.push({ ...draft });
    handler = ({ method }) => (method === "PUT" ? { status: 503, json: { error: "backend" } } : undefined);
    const { attemptSend } = await import("@/lib/send");
    const first = await attemptSend("d1", db.tables.restaurants[0] as never, NOON_UK, "approve");
    expect(first).toMatchObject({ outcome: "queued", reason: "scheduled" });
    expect(db.tables.drafts[0]).toMatchObject({ status: "queued", sent_at: null });
    expect(db.tables.sent_log).toHaveLength(0);
    expect(googleCalls("PUT", "/reply")).toHaveLength(4); // tried 4 times with backoff

    // The retry: Google is back, it posts once.
    handler = () => undefined;
    const second = await attemptSend("d1", db.tables.restaurants[0] as never, new Date(NOON_UK.getTime() + 3_600_000), "queue");
    expect(second).toMatchObject({ outcome: "sent" });
    expect(db.tables.sent_log[0]).toMatchObject({ simulated: false });

    // A reply Google refuses outright (400) is blocked with the reason.
    db.tables.drafts.push({ ...draft, id: "d2", content: "Another reply" });
    handler = ({ method }) => (method === "PUT" ? { status: 400, json: { error: { message: "Reply too long" } } } : undefined);
    const third = await attemptSend("d2", db.tables.restaurants[0] as never, NOON_UK, "approve");
    expect(third).toMatchObject({ outcome: "blocked", reason: "google_error" });
    expect(db.tables.drafts.find((d) => d.id === "d2")).toMatchObject({ status: "blocked" });
  });
});

describe("signing in", () => {
  test("tokens are stored encrypted; the sign-in state only works unchanged and in time", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/google/crypto");
    const stored = encryptToken("refresh-secret");
    expect(stored).not.toContain("refresh-secret");
    expect(decryptToken(stored)).toBe("refresh-secret");
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."))).toThrow();

    vi.stubEnv("LINK_SECRET", "link-secret");
    const { signState, readState, authUrl } = await import("@/lib/google/oauth");
    const s = signState({ r: R, as: "owner", email: "owner@x.test", back: "/settings/google" }, 1_000_000);
    expect(readState(s, 1_000_000 + 60_000)).toEqual({ r: R, as: "owner", email: "owner@x.test", back: "/settings/google" });
    expect(readState(s, 1_000_000 + 16 * 60_000)).toBeNull();
    expect(readState(s.replace(/^./, "x"), 1_000_000)).toBeNull();
    const url = new URL(authUrl(s));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/business.manage");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.dinerai.co.uk/api/google/callback");
  });
});
