import "server-only";
import { createHash } from "node:crypto";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import * as api from "./api";
import { linkFor, type GoogleLink } from "./connections";
import { dummyGoogle } from "./dummy";
import { hoursToPeriods, localPostBody, reviewRow, reviewsToQueue, samePostText, specialToGoogle, sumPerformance } from "./mapping";
import { GoogleAuthError } from "./oauth";
import { onceOnGoogle } from "./writes";
import type { GoogleConnector, GooglePost, GoogleReview } from "./types";

// Live mode: the real Google Business Profile API, for a restaurant that has
// linked its Google location (lib/google/index.ts picks this per restaurant).
// Reviews are copied into our `reviews` table (source 'google_live', once each
// by google_review_id), so the review check, drafts, the brief and the report
// work exactly as in dummy mode. Every write is keyed on its job (writes.ts).

async function mustLink(restaurantId: string): Promise<GoogleLink> {
  const link = await linkFor(restaurantId);
  if (!link) throw new Error("This restaurant isn't connected to Google");
  return link;
}

export const LIVE_SOURCE = "google_live";

// Copies Google's newest reviews into our table. New ones arrive unhandled, so
// the review check drafts replies to them; reviews already replied to on Google
// count as handled. The first time (on connect), only the newest few unreplied
// recent reviews are left for the queue (mapping.reviewsToQueue).
export async function syncReviews(link: GoogleLink, opts: { max?: number; firstTime?: boolean } = {}) {
  const supabase = getSupabase();
  const restaurantId = link.restaurant.id;
  const { reviews, total } = await api.listReviews(link, opts.max ?? 50);
  const rows = reviews.map((r) => reviewRow(restaurantId, r)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (rows.length) check(await supabase.from("reviews").upsert(rows, { onConflict: "restaurant_id,google_review_id" }));

  const now = new Date().toISOString();
  // Replied to on Google already (by the owner, or by us): nothing to draft.
  check(await supabase.from("reviews").update({ handled_at: now }).eq("restaurant_id", restaurantId).eq("source", LIVE_SOURCE).eq("replied", true).is("handled_at", null));
  let queued = rows.filter((r) => !r.replied).length;
  if (opts.firstTime) {
    const keep = reviewsToQueue(reviews, new Date());
    const seen = reviews.map((r) => r.reviewId).filter((id) => !keep.has(id));
    if (seen.length) check(await supabase.from("reviews").update({ handled_at: now }).eq("restaurant_id", restaurantId).in("google_review_id", seen).is("handled_at", null));
    queued = keep.size;
  }
  return { count: rows.length, total, queued };
}

async function reviewRowFor(restaurantId: string, reviewId: string) {
  return check(
    await getSupabase()
      .from("reviews")
      .select("id, google_review_id, source")
      .eq("restaurant_id", restaurantId)
      .eq("id", reviewId)
      .maybeSingle<{ id: string; google_review_id: string | null; source: string }>(),
  );
}

const textKey = (text: string) => createHash("sha256").update(text.trim()).digest("hex").slice(0, 12);

export const liveGoogle: GoogleConnector = {
  mode: "live",

  async listReviews(restaurantId) {
    const res = await getSupabase()
      .from("reviews")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("source", LIVE_SOURCE)
      .order("review_date", { ascending: false })
      .returns<GoogleReview[]>();
    return check(res) ?? [];
  },

  async claimNewReviews(restaurantId) {
    const link = await mustLink(restaurantId);
    try {
      await syncReviews(link, { max: 20, firstTime: !link.restaurant.google_imported_at });
    } catch (err) {
      // A login that needs reconnecting has already been flagged and the owner
      // sent a link (connections.loginBroken): don't fail the hourly job over it.
      if (!(err instanceof GoogleAuthError)) throw err;
    }
    return dummyGoogle.claimNewReviews(restaurantId);
  },

  markReviewHandled: (reviewId) => dummyGoogle.markReviewHandled(reviewId),
  releaseReview: (reviewId) => dummyGoogle.releaseReview(reviewId),

  async replyToReview(restaurantId, reviewId, text) {
    const row = await reviewRowFor(restaurantId, reviewId);
    // A dummy review on a connected restaurant stays dummy.
    if (!row?.google_review_id) return dummyGoogle.replyToReview(restaurantId, reviewId, text);
    const link = await mustLink(restaurantId);
    // Keyed on the review and the exact wording: the same reply is never sent
    // twice, an edited one is. (PUT replaces a reply anyway: belt and braces.)
    const reply = await onceOnGoogle({ restaurantId, key: `reply:${reviewId}:${textKey(text)}`, action: "reply" }, () => api.putReply(link, row.google_review_id!, text));
    check(
      await getSupabase()
        .from("reviews")
        .update({ reply_text: text, reply_posted_at: reply?.updateTime ?? new Date().toISOString(), replied: true })
        .eq("id", reviewId)
        .eq("restaurant_id", restaurantId),
    );
  },

  async removeReply(restaurantId, reviewId) {
    const row = await reviewRowFor(restaurantId, reviewId);
    if (!row?.google_review_id) return dummyGoogle.removeReply(restaurantId, reviewId);
    const link = await mustLink(restaurantId);
    await api.deleteReply(link, row.google_review_id);
    const supabase = getSupabase();
    // The reply is gone, so approving it again must really post it again.
    check(await supabase.from("google_writes").delete().eq("restaurant_id", restaurantId).like("key", `reply:${reviewId}:%`));
    check(await supabase.from("reviews").update({ reply_text: null, reply_posted_at: null, replied: false }).eq("id", reviewId).eq("restaurant_id", restaurantId));
  },

  async publishPost(restaurantId, post) {
    const link = await mustLink(restaurantId);
    const made = await onceOnGoogle(
      { restaurantId, key: `post:${post.id}`, action: "post" },
      async () => {
        const p = await api.createLocalPost(link, localPostBody(post));
        return { name: p.name, searchUrl: p.searchUrl ?? null };
      },
      // A run that died after Google made the post: find it by its wording.
      async () => {
        const found = (await api.listLocalPosts(link, 10)).find((p) => samePostText(p.summary, post.text));
        return found ? { name: found.name, searchUrl: found.searchUrl ?? null } : null;
      },
    );
    check(
      await getSupabase()
        .from("google_posts")
        .update({ published_at: new Date().toISOString(), google_post_id: made.name, google_url: made.searchUrl, withdrawn_at: null })
        .eq("id", post.id)
        .eq("restaurant_id", restaurantId),
    );
    return { googlePostId: made.name };
  },

  async unpublishPost(restaurantId, postId) {
    const supabase = getSupabase();
    const post = check(await supabase.from("google_posts").select("*").eq("id", postId).eq("restaurant_id", restaurantId).maybeSingle<GooglePost>());
    if (!post) return;
    if (post.google_post_id?.startsWith("accounts/")) await api.deleteLocalPost(await mustLink(restaurantId), post.google_post_id);
    check(await supabase.from("google_writes").delete().eq("restaurant_id", restaurantId).eq("key", `post:${postId}`));
    check(await supabase.from("google_posts").update({ published_at: null, withdrawn_at: new Date().toISOString() }).eq("id", postId).eq("restaurant_id", restaurantId));
  },

  listPublishedPosts: (restaurantId) => dummyGoogle.listPublishedPosts(restaurantId),

  // The restaurant's current hours and special hours, as saved here, copied to Google.
  async updateHours(restaurantId, jobKey) {
    const link = await mustLink(restaurantId);
    const today = londonYmd(new Date());
    await onceOnGoogle({ restaurantId, key: `hours:${jobKey}`, action: "hours" }, async () => {
      await api.updateHours(link, { regular: hoursToPeriods(link.restaurant.opening_hours ?? {}), special: specialToGoogle(link.restaurant.special_hours, today) });
      return { at: new Date().toISOString() };
    });
  },

  async uploadPhoto(restaurantId, url, jobKey, category) {
    const link = await mustLink(restaurantId);
    return onceOnGoogle({ restaurantId, key: `photo:${jobKey}`, action: "photo" }, async () => {
      const m = await api.createMedia(link, url, category);
      return { name: m.name, googleUrl: m.googleUrl ?? null };
    });
  },

  async getInsights(restaurantId, start, end) {
    const link = await mustLink(restaurantId);
    // `end` is exclusive; Google's range is inclusive.
    const last = new Date(end.getTime() - 86_400_000);
    return sumPerformance(await api.fetchPerformance(link, londonYmd(start), londonYmd(last)));
  },
};
