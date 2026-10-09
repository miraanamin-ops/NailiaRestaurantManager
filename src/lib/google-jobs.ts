import "server-only";
import { writeGooglePost, writeReviewReply, type RestaurantContext } from "@/lib/assistant";
import { checkDraft } from "@/lib/checker";
import { check, createDraft, getLearningContext, getQueue, takeNextFromQueue, type Draft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import { google, type GooglePost, type GoogleReview } from "@/lib/google";
import { getSupabase } from "@/lib/supabase";
import type { ButtonTarget } from "@/lib/whatsapp";

export type Send = (text: string, withButtons?: boolean | ButtonTarget) => Promise<void>;

export const stars = (n: number) => "⭐".repeat(n);

async function queueNote(restaurantId: string) {
  const n = (await getQueue(restaurantId)).length;
  return n ? `\n\n_📥 ${n} more waiting for your morning brief._` : "";
}

// The hourly review check: every new review gets a drafted reply.
// 4-5 stars are held quietly for the morning brief; 1-3 stars are sent at once as an alert.
export async function runReviewCheck(ctx: RestaurantContext, send: Send) {
  const reviews = await google().claimNewReviews(ctx.restaurantId);
  const learning = await getLearningContext(ctx.restaurantId);
  let alerts = 0;
  let held = 0;

  for (const review of reviews) {
    const urgent = review.rating <= 3;
    let draft: Draft;
    try {
      const content = await writeReviewReply(ctx, learning, review);
      const checked = await checkDraft(ctx, {
        kind: "review_reply",
        audience: `Google review by ${review.author_name}`,
        content,
        context: `Replying to this ${review.rating}-star review: "${review.text}"`,
      });
      draft = await createDraft({
        restaurantId: ctx.restaurantId,
        kind: "review_reply",
        content: checked.content,
        audience: `Google review by ${review.author_name}`,
        request: urgent ? "Review check: low rating alert" : "Review check",
        reviewId: review.id,
        checkNotes: checked.notes,
        mode: urgent ? "urgent" : "hold",
      });
    } catch (err) {
      // Put it back so the next check tries again, then carry on with the rest.
      console.error("Drafting a review reply failed", err);
      await google().releaseReview(review.id);
      continue;
    }

    if (urgent) {
      alerts++;
      const quote = `${review.author_name} ${stars(review.rating)}\n_"${review.text ?? "(rating only)"}"_`;
      await send(
        `🚨 *${review.rating}-star review just came in.* I've drafted a careful reply below. Nothing is posted until you approve it.\n\n${quote}\n\n${draftMessage(draft, ctx.restaurant)}${await queueNote(ctx.restaurantId)}`,
        true,
      );
    } else {
      held++; // no message: it's in tomorrow's brief
    }
  }
  return { found: reviews.length, alerts, held };
}

// Drafts one Google post and holds it for the morning brief. Runs Mondays and Thursdays.
export async function runPostJob(ctx: RestaurantContext) {
  const recent =
    check(
      await getSupabase()
        .from("google_posts")
        .select("text")
        .eq("restaurant_id", ctx.restaurantId)
        .order("created_at", { ascending: false })
        .limit(5)
        .returns<{ text: string }[]>(),
    ) ?? [];
  const learning = await getLearningContext(ctx.restaurantId);
  const post = await writeGooglePost(ctx, learning, recent.map((p) => p.text));
  return createPostDraft(ctx, { topic: post.topic, text: post.text, photoUrl: null, request: "Twice-weekly Google post", mode: "hold" });
}

// Checker, then a draft plus its google_posts row (published only once approved).
export async function createPostDraft(
  ctx: RestaurantContext,
  input: { topic: GooglePost["topic"]; text: string; photoUrl: string | null; request: string; mode: "present" | "hold" },
) {
  const checked = await checkDraft(ctx, {
    kind: "google_post",
    audience: "the Google listing",
    content: input.text,
    context: input.photoUrl ? "This post goes with a photo the owner sent." : undefined,
  });
  const draft = await createDraft({
    restaurantId: ctx.restaurantId,
    kind: "google_post",
    content: checked.content,
    audience: "your Google listing",
    request: input.request,
    checkNotes: checked.notes,
    mode: input.mode,
  });
  check(
    await getSupabase().from("google_posts").insert({
      restaurant_id: ctx.restaurantId,
      draft_id: draft.id,
      topic: input.topic,
      text: checked.content,
      photo_url: input.photoUrl,
    }),
  );
  return draft;
}

const TOPIC_LABELS: Record<GooglePost["topic"], string> = { update: "Update", offer: "Offer", event: "Event" };

export function postMessage(draft: Draft, topic: GooglePost["topic"], photoUrl: string | null, ctx: RestaurantContext) {
  const extra = `_Type: ${TOPIC_LABELS[topic]}${photoUrl ? " · with your photo 📷" : ""}_`;
  return `${draftMessage(draft, ctx.restaurant)}\n\n${extra}`;
}

// After the owner finishes with a draft, bring the next queued one forward
// (only drafts they asked for; brief items wait for the brief unless includeBrief, i.e. NEXT).
export async function presentNext(ctx: RestaurantContext, send: Send, includeBrief = false) {
  const next = await takeNextFromQueue(ctx.restaurantId, includeBrief);
  if (!next) return false;
  let intro = "📥 *Next in your queue*";
  if (next.kind === "review_reply" && next.review_id) {
    const review = (await google().listReviews(ctx.restaurantId)).find((r: GoogleReview) => r.id === next.review_id);
    if (review) intro += `\n${review.author_name} ${stars(review.rating)}\n_"${review.text ?? ""}"_`;
  }
  await send(`${intro}\n\n${draftMessage(next, ctx.restaurant)}${await queueNote(ctx.restaurantId)}`, true);
  return true;
}
