import "server-only";
import { writeGooglePost, writeReviewReply, type RestaurantContext } from "@/lib/assistant";
import { checkDraft } from "@/lib/checks";
import type { DraftChecks } from "@/lib/checks/types";
import { check, createDraft, getLearningContext, getQueue, takeNextFromQueue, type AgentCheck, type Draft } from "@/lib/drafts";
import { draftPreviewUrl } from "@/lib/email/previews";
import { draftMessage } from "@/lib/format";
import { google, type GooglePost, type GoogleReview } from "@/lib/google";
import { liveReputation, queueReputationShadow, reputationMode } from "@/lib/agents/reputation";
import { queueVisibilityLive, queueVisibilityShadow, visibilityMode } from "@/lib/agents/visibility";
import { londonWeekday, londonYmd } from "@/lib/clock";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { ButtonTarget } from "@/lib/whatsapp";

// mediaUrl: a picture sent first (the preview image of an email draft).
export type Send = (text: string, withButtons?: boolean | ButtonTarget, mediaUrl?: string | null) => Promise<void>;

export const stars = (n: number) => "⭐".repeat(n);

// The buttons a draft gets on WhatsApp: a question about a review gets Reply
// publicly / Handle privately / Both (carrying its id); everything else Approve / Edit / Skip.
export function buttonsFor(draft: Pick<Draft, "id" | "kind">): true | ButtonTarget {
  if (draft.kind === "hours_question") return { draftId: draft.id, buttons: "hours" };
  return draft.kind === "review_question" ? { draftId: draft.id, buttons: "question" } : true;
}

async function queueNote(restaurantId: string) {
  const n = (await getQueue(restaurantId)).length;
  return n ? `\n\n_📥 ${n} more waiting for your morning brief._` : "";
}

// The hourly review check: every new review gets a drafted reply.
// 4-5 stars are held quietly for the morning brief; 1-3 stars are sent at once as an alert.
export async function runReviewCheck(ctx: RestaurantContext, send: Send) {
  const reviews = await google().claimNewReviews(ctx.restaurantId);
  const learning = await getLearningContext(ctx.restaurantId);
  // Reputation live for this restaurant: it writes the replies (or asks the owner).
  const live = reputationMode(ctx.restaurant) === "live";
  let alerts = 0;
  let held = 0;
  let failed = 0;

  for (const review of reviews) {
    const urgent = review.rating <= 3;
    let draft: Draft;
    try {
      if (live) {
        const result = await liveReputation(
          ctx.restaurant,
          { id: review.id, author_name: review.author_name, rating: review.rating, text: review.text },
          { source: "review_check", draftMode: urgent ? "urgent" : "hold" },
        );
        draft = result.draft!;
        // Its reply (or question) draft is saved, so the review counts as handled.
        await google().markReviewHandled(review.id);
      } else {
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
          checks: checked.checks,
          mode: urgent ? "urgent" : "hold",
        });
        // Only now, with its reply draft saved, does the review count as handled.
        await google().markReviewHandled(review.id);
        // Shadow mode: the Reputation agent writes its own reply in the background,
        // for the /log comparison. The owner only ever sees the draft above.
        await queueReputationShadow(ctx.restaurant, {
          source: "review_check",
          review: { id: review.id, author_name: review.author_name, rating: review.rating, text: review.text },
          legacy_draft_id: draft.id,
          legacy_text: draft.content,
        });
      }
    } catch (err) {
      // Put it back so the next check tries again, then carry on with the rest.
      // (If even this fails, the claim simply expires and the review is retried.)
      console.error("Drafting a review reply failed", err);
      failed++;
      await google().releaseReview(review.id).catch(() => {});
      continue;
    }

    if (urgent) {
      alerts++;
      const quote = `${review.author_name} ${stars(review.rating)}\n_"${review.text ?? "(rating only)"}"_`;
      // The GM live (test mode): at most one alert an hour, held in quiet hours.
      const { gmMode } = await import("@/lib/agents/gm");
      if ((await gmMode(ctx.restaurant)) === "live") {
        const { gmAlert } = await import("@/lib/agents/gm-brief");
        await gmAlert(ctx.restaurant, send, ctx.now, { draft, detail: `*${review.rating}-star review just came in.*\n\n${quote}` });
        continue;
      }
      const question = draft.kind === "review_question";
      await send(
        `🚨 *${review.rating}-star review just came in.* ${question ? "It needs your decision before anything is drafted." : "I've drafted a careful reply below. Nothing is posted until you approve it."}\n\n${quote}\n\n${draftMessage(draft, ctx.restaurant)}${await queueNote(ctx.restaurantId)}`,
        buttonsFor(draft),
      );
    } else {
      held++; // no message: it's in tomorrow's brief
    }
  }
  return { found: reviews.length, alerts, held, failed };
}

// Drafts one Google post and holds it for the morning brief. Runs Mondays and Thursdays.
export async function runPostJob(ctx: RestaurantContext) {
  const slot = londonWeekday(ctx.now) === 4 ? "Thursday" : "Monday";
  // Visibility live: it writes the post (checked by the checker), held for the brief.
  // Run straight away, so the post is ready for the brief that follows.
  if ((await visibilityMode(ctx.restaurant)) === "live") {
    await queueVisibilityLive(ctx.restaurant, { task: "google_post", slot }, `visibility:post:${slot}:${londonYmd(ctx.now)}`);
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(ctx.restaurantId);
    return null;
  }
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
  const draft = await createPostDraft(ctx, { topic: post.topic, text: post.text, photoUrl: null, request: "Twice-weekly Google post", mode: "hold" });
  // Shadow mode: Visibility writes its own post in the background, for the /log comparison.
  await queueVisibilityShadow(ctx.restaurant, {
    task: "google_post",
    slot,
    legacy_draft_id: draft.id,
    legacy_text: draft.content,
  });
  return draft;
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
    checks: checked.checks,
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

// A Google post Visibility wrote (live mode): already checked by the checker agent,
// so it's saved with that verdict, plus its google_posts row (published only once approved).
export async function createAgentPostDraft(
  restaurant: Restaurant,
  input: { text: string; photoUrl: string | null; request: string; checks: DraftChecks; agentCheck: AgentCheck; mode: "present" | "hold" },
) {
  const draft = await createDraft({
    restaurantId: restaurant.id,
    kind: "google_post",
    content: input.text,
    audience: "your Google listing",
    request: input.request,
    checks: input.checks,
    mode: input.mode,
    actor: "visibility",
    agentCheck: input.agentCheck,
  });
  check(await getSupabase().from("google_posts").insert({ restaurant_id: restaurant.id, draft_id: draft.id, topic: "update", text: input.text, photo_url: input.photoUrl }));
  return draft;
}

const TOPIC_LABELS:Record<GooglePost["topic"], string> = { update: "Update", offer: "Offer", event: "Event" };

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
  await send(`${intro}\n\n${draftMessage(next, ctx.restaurant)}${await queueNote(ctx.restaurantId)}`, buttonsFor(next), draftPreviewUrl(next));
  return true;
}
