import "server-only";
import { draftMessage } from "@/lib/format";
import { buttonsFor } from "@/lib/google-jobs";
import { check, focusDraft, type Draft } from "@/lib/drafts";
import { google } from "@/lib/google";
import { getSupabase } from "@/lib/supabase";
import type { Turn } from "@/lib/bot/turn";
import { asksAboutReviews, pickReview, starsMentioned, waitingReviewsText } from "./gm-review-rules";
import type { RouterOutputType } from "./gm-rules";
import { liveReputation } from "./reputation";

// The GM's reputation route, with Reputation live:
//   a review the owner pasted: Reputation's checked reply to copy into Google themselves (nothing is posted);
//   "reply to the 2 star one" / "answer Tom's review": that Google review's reply on
//   screen (its draft if there is one, else Reputation writes it); Approve sends it
//   through the release gate like any other draft.
// Returns false when it isn't a request it can act on (the caller says so).
export async function reputationRequest(turn: Turn, body: string, pasted: RouterOutputType["pasted_review"]): Promise<boolean> {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  if (pasted?.text.trim()) {
    const { pastedReviewReply } = await import("@/lib/bot/flows");
    await pastedReviewReply(ctx, { authorName: pasted.author_name?.trim() || "the reviewer", rating: pasted.rating ?? starsMentioned(body), text: pasted.text.trim() }, send);
    return true;
  }
  const reviews = (await google().listReviews(r.id)).map((x) => ({ ...x, replied: x.replied || Boolean(x.reply_posted_at) }));
  // A question about the reviews ("which still need a reply?"): the list, not a draft.
  if (asksAboutReviews(body)) {
    await send(waitingReviewsText(reviews));
    return true;
  }
  const review = pickReview(body, reviews);
  if (!review) {
    await send(reviews.length ? "I couldn't tell which review you mean. Tell me the reviewer's name or the stars (e.g. _reply to the 2 star one_), or paste the review here." : "There are no Google reviews here yet. Paste a review into this chat and I'll write a reply for you to copy.");
    return true;
  }
  if (review.replied) {
    await send(`${review.author_name.replace(/\.$/, "")}'s review already has a reply${review.reply_text ? `:\n\n${review.reply_text}` : "."}`);
    return true;
  }
  // A reply already drafted (e.g. waiting for the morning brief): bring it on screen.
  const existing =
    check(
      await getSupabase()
        .from("drafts")
        .select("*")
        .eq("restaurant_id", r.id)
        .eq("review_id", review.id)
        .in("status", ["pending", "blocked"])
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<Draft[]>(),
    )?.[0] ?? null;
  if (existing) {
    const draft = await focusDraft(existing, "decision");
    await send(draftMessage(draft, r), buttonsFor(draft));
    return true;
  }
  const result = await liveReputation(r, { id: review.id, author_name: review.author_name, rating: review.rating, text: review.text }, { source: "review_check", draftMode: "present" });
  const draft = result.draft!;
  await google().markReviewHandled(review.id);
  await send(draftMessage(draft, r), buttonsFor(draft));
  return true;
}
