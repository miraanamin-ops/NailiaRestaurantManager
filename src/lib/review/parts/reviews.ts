import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { check, getLearningContext, type Draft } from "@/lib/drafts";
import { googleModeFor } from "@/lib/google";
import { linkFor } from "@/lib/google/connections";
import { draftReviewReply } from "@/lib/google-jobs";
import { getSupabase } from "@/lib/supabase";
import { BACKLOG_MAX_AGE_DAYS, REPLIES_PER_DAY, REPLY_BATCH, REVIEWS_MAX } from "../config";
import { passedEveryCheck } from "../rules";
import { logTimeSaved } from "../time-saved";
import type { PartResults } from "../types";
import { continueWith, type PartContext } from ".";

// The review backlog: the most recent reviews (up to 200) read from Google,
// then a reply drafted for each one with no reply, in the restaurant's voice,
// through the usual checks, held for the guided flow (or the morning brief).
// Nothing is posted: approving them is the owner's, and posting is the gate's.

const db = () => getSupabase();
type ReviewRow = { id: string; rating: number | null; text: string | null; author_name: string; replied: boolean; reply_text: string | null; review_date: string; source: string };

// The latest REVIEWS_MAX reviews in our table (after the sync), newest first.
async function latestReviews(restaurantId: string) {
  return (check(await db().from("reviews").select("*").eq("restaurant_id", restaurantId).order("review_date", { ascending: false }).limit(REVIEWS_MAX)) ?? []) as ReviewRow[];
}

// Unanswered and under a year old (replying years later looks odd), the worst-rated
// first, then the newest: the order old reviews get their drafts in.
export function backlogOrder<T extends { rating: number | null; review_date: string; replied: boolean; reply_text: string | null }>(rows: T[], now = new Date()): T[] {
  const since = new Date(now.getTime() - BACKLOG_MAX_AGE_DAYS * 86_400_000).toISOString();
  return rows
    .filter((r) => !r.replied && !r.reply_text && r.review_date >= since)
    .sort((a, b) => Number((a.rating ?? 5) > 3) - Number((b.rating ?? 5) > 3) || b.review_date.localeCompare(a.review_date));
}
const unanswered = (rows: ReviewRow[], now = new Date()) => backlogOrder(rows, now);

export async function syncPart(ctx: PartContext): Promise<PartResults["reviews_sync"]> {
  const r = ctx.restaurant;
  if (!ctx.connected) return { connected: false, rating: null, total: null, synced: 0, unanswered: 0 };
  let rating: number | null = null;
  let total: number | null = null;
  if ((await googleModeFor(r.id)) !== "dummy") {
    const link = await linkFor(r.id);
    if (!link) throw new Error("Google is linked but the login can't reach the location");
    const { syncReviews } = await import("@/lib/google/live");
    const synced = await syncReviews(link, { max: REVIEWS_MAX });
    rating = synced.average;
    total = synced.total;
  } else {
    // Dummy Google: the reviews are already in our table; the profile may say the totals.
    const p = (r.dummy_google_profile ?? {}) as { rating?: number; reviewCount?: number };
    rating = typeof p.rating === "number" ? p.rating : null;
    total = typeof p.reviewCount === "number" ? p.reviewCount : null;
  }
  const rows = await latestReviews(r.id);
  // The business review takes over every review it read: the hourly check won't
  // also draft (or alert about) the older ones it has just copied in.
  if (rows.length) {
    check(await db().from("reviews").update({ handled_at: ctx.now.toISOString() }).eq("restaurant_id", r.id).in("id", rows.map((x) => x.id)).is("handled_at", null));
  }
  const rated = rows.filter((x) => typeof x.rating === "number");
  if (rating === null && rated.length) rating = Math.round((rated.reduce((s, x) => s + (x.rating ?? 0), 0) / rated.length) * 10) / 10;
  if (total === null) total = rows.length;
  return { connected: true, rating: rating === null ? null : Math.round(rating * 10) / 10, total, synced: rows.length, unanswered: unanswered(rows).length };
}

// Reply drafts the review made (or picked up), with each review's rating.
export async function reviewReplyDrafts(restaurantId: string, reviewId: string) {
  const drafts = (check(await db().from("drafts").select("*").eq("restaurant_id", restaurantId).eq("business_review_id", reviewId).in("kind", ["review_reply", "review_question"])) ?? []) as Draft[];
  const ids = drafts.map((d) => d.review_id).filter(Boolean) as string[];
  const reviews = new Map<string, ReviewRow>();
  if (ids.length) {
    const rows = (check(await db().from("reviews").select("id, rating, author_name, text").eq("restaurant_id", restaurantId).in("id", ids)) ?? []) as ReviewRow[];
    for (const x of rows) reviews.set(x.id, x);
  }
  return drafts
    .map((d) => {
      const rv = d.review_id ? reviews.get(d.review_id) : undefined;
      return { ...d, rating: rv?.rating ?? null, reviewAuthor: rv?.author_name ?? null, reviewText: rv?.text ?? null };
    })
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.created_at.localeCompare(b.created_at));
}

export function backlogCounts(drafts: Awaited<ReturnType<typeof reviewReplyDrafts>>, unansweredCount: number): PartResults["backlog"] {
  const live = drafts.filter((d) => d.status !== "superseded" && d.status !== "withdrawn");
  return {
    unanswered: unansweredCount,
    drafted: Math.min(unansweredCount, live.length),
    positiveReady: live.filter((d) => d.kind === "review_reply" && d.status === "pending" && (d.rating ?? 0) >= 4 && passedEveryCheck(d)).length,
    negative: live.filter((d) => (d.rating ?? 5) <= 3).length,
  };
}

const CLAIM_MINUTES = 10;

export async function backlogPart(ctx: PartContext) {
  const r = ctx.restaurant;
  if (!ctx.connected) return { unanswered: 0, drafted: 0, positiveReady: 0, negative: 0 };
  const rows = unanswered(await latestReviews(r.id), ctx.now);
  // Reviews that already have a reply draft waiting (e.g. from the hourly check) are picked up, not drafted again.
  const existing = rows.length
    ? ((check(await db().from("drafts").select("id, review_id, status, business_review_id").eq("restaurant_id", r.id).in("review_id", rows.map((x) => x.id))) ?? []) as Pick<Draft, "id" | "review_id" | "status" | "business_review_id">[])
    : [];
  const waiting = existing.filter((d) => ["pending", "approved", "queued", "sent", "answered"].includes(d.status));
  const adopt = waiting.filter((d) => !d.business_review_id && d.status === "pending").map((d) => d.id);
  if (adopt.length) check(await db().from("drafts").update({ business_review_id: ctx.review.id }).eq("restaurant_id", r.id).in("id", adopt));
  const covered = new Set(waiting.map((d) => d.review_id));
  // Day one drafts at most REPLIES_PER_DAY; the rest come REPLIES_PER_DAY a morning (dailyBacklog).
  const budget = Math.max(0, REPLIES_PER_DAY - waiting.filter((d) => d.business_review_id === ctx.review.id || adopt.includes(d.id)).length);
  const todo = rows.filter((x) => !covered.has(x.id)).slice(0, Math.min(REPLY_BATCH, budget));

  if (todo.length) {
    // Claim them, so two runs (or the hourly check) never draft the same review twice.
    const expired = new Date(ctx.now.getTime() - CLAIM_MINUTES * 60_000).toISOString();
    const claimed = (check(
      await db()
        .from("reviews")
        .update({ claimed_at: ctx.now.toISOString() })
        .eq("restaurant_id", r.id)
        .in("id", todo.map((x) => x.id))
        .or(`claimed_at.is.null,claimed_at.lt.${expired}`)
        .select("id"),
    ) ?? []) as { id: string }[];
    const mine = todo.filter((x) => claimed.some((c) => c.id === x.id));
    const rctx = await loadRestaurantContext(r.id, { realTime: true });
    const learning = await getLearningContext(r.id);
    // Three at a time: each is a write and its checks.
    let made = 0;
    for (let i = 0; i < mine.length; i += 3) {
      await Promise.all(
        mine.slice(i, i + 3).map(async (review) => {
          try {
            const draft = await draftReviewReply(rctx, learning, { ...review, rating: review.rating ?? 0 }, { mode: "hold", request: "Business review: a review with no reply", live: undefined });
            check(await db().from("drafts").update({ business_review_id: ctx.review.id }).eq("id", draft.id).eq("restaurant_id", r.id));
            await logTimeSaved(r.id, "review_reply", draft.id);
            made++;
          } catch (err) {
            console.error("Couldn't draft a reply for the business review", err);
            await db().from("reviews").update({ claimed_at: null }).eq("id", review.id).eq("restaurant_id", r.id);
          }
        }),
      );
    }
    // Every one failed: stop here (the builder has the errors) rather than trying the same ones for ever.
    if (mine.length && !made) return backlogCounts(await reviewReplyDrafts(r.id, ctx.review.id), rows.length);
  }
  const counts = backlogCounts(await reviewReplyDrafts(r.id, ctx.review.id), rows.length);
  const left = rows.length - waiting.length - todo.length;
  return left > 0 && budget - todo.length > 0 ? continueWith(counts) : counts;
}

// Each morning before the brief: the next REPLIES_PER_DAY old reviews get a held
// reply draft, so they arrive in that brief for approval, until the backlog is clear.
// Only once setup has finished and Google is connected (a finished business review).
export async function dailyBacklog(r: import("@/lib/supabase").Restaurant, now: Date) {
  const { data: review } = await db().from("business_reviews").select("id, google_connected, status").eq("restaurant_id", r.id).maybeSingle<{ id: string; google_connected: boolean | null; status: string }>();
  if (!review?.google_connected) return { drafted: 0, skipped: "Google isn't connected" };
  const rows = unanswered(await latestReviews(r.id), now);
  if (!rows.length) return { drafted: 0 };
  const existing = (check(await db().from("drafts").select("review_id, status").eq("restaurant_id", r.id).in("review_id", rows.map((x) => x.id))) ?? []) as { review_id: string; status: string }[];
  const covered = new Set(existing.filter((d) => !["superseded", "withdrawn", "skipped"].includes(d.status)).map((d) => d.review_id));
  // Today's own allowance: drafts already made today for old reviews count.
  const dayStart = new Date(now.getTime() - 20 * 3_600_000).toISOString();
  const { count: today } = await db().from("drafts").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("kind", "review_reply").eq("request", BACKLOG_REQUEST).gte("created_at", dayStart);
  const todo = rows.filter((x) => !covered.has(x.id)).slice(0, Math.max(0, REPLIES_PER_DAY - (today ?? 0)));
  if (!todo.length) return { drafted: 0 };
  const rctx = await loadRestaurantContext(r.id, { realTime: true });
  const learning = await getLearningContext(r.id);
  let drafted = 0;
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(
      todo.slice(i, i + 3).map(async (review) => {
        try {
          const draft = await draftReviewReply(rctx, learning, { ...review, rating: review.rating ?? 0 }, { mode: "hold", request: BACKLOG_REQUEST, live: undefined });
          await logTimeSaved(r.id, "review_reply", draft.id);
          drafted++;
        } catch (err) {
          console.error("Couldn't draft a reply for an old review", err);
        }
      }),
    );
  }
  return { drafted, left: rows.length - covered.size - drafted };
}
const BACKLOG_REQUEST = "An older review with no reply (15 a day)";
