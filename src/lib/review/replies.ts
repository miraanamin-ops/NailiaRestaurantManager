import "server-only";
import { randomUUID } from "node:crypto";
import { approveDraft, check, type Draft } from "@/lib/drafts";
import { PermanentJobError, type JobHandler } from "@/lib/queue/registry";
import { enqueue } from "@/lib/queue/store";
import { attemptSend } from "@/lib/send";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { REPLY_RELEASE_SECONDS } from "./config";
import { reviewReplyDrafts } from "./parts/reviews";
import { approveAllSet, passedEveryCheck } from "./rules";

// Approving the review's replies. Approve all only ever takes 4 to 5 star
// replies that passed every check (approveAllSet); the rest go one by one.
// Approving records the owner's decision (one batch, so one UNDO takes them
// all back); each reply then goes to Google through the release gate as its
// own job, a few seconds apart (Google's limits), and a retry never posts twice.

export async function repliesFor(restaurantId: string, reviewId: string) {
  const all = await reviewReplyDrafts(restaurantId, reviewId);
  const pending = all.filter((d) => d.status === "pending");
  const positive = approveAllSet(pending);
  const oneByOne = pending.filter((d) => !positive.includes(d));
  return { all, pending, positive, oneByOne };
}

export async function approveAllPositive(restaurant: Restaurant, reviewId: string, now: Date) {
  const { positive } = await repliesFor(restaurant.id, reviewId);
  const batchId = randomUUID();
  let i = 0;
  for (const d of positive) {
    // Checked again just before: only a reply still waiting that passed every check.
    if (!passedEveryCheck(d) || (d.rating ?? 0) < 4) continue;
    await approveDraft(d as Draft, batchId);
    await enqueue({
      type: "review_reply_release",
      restaurantId: restaurant.id,
      key: `review_reply_release:${d.id}`,
      payload: { draftId: d.id },
      runAt: new Date(now.getTime() + i * REPLY_RELEASE_SECONDS * 1000),
    });
    i++;
  }
  return { approved: i, batchId };
}

// One approved reply through the release gate. Not approved any more (e.g.
// UNDO came first): the gate refuses it, nothing is posted.
export const releaseReplyHandler: JobHandler = {
  run: async (job) => {
    const draftId = String(job.payload.draftId ?? "");
    if (!job.restaurant_id) throw new PermanentJobError("This job has no restaurant");
    const r = check(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).maybeSingle<Restaurant>());
    if (!r) throw new PermanentJobError("The restaurant is gone");
    const result = await attemptSend(draftId, r, new Date(), "approve");
    return { outcome: result.outcome, ...(result.outcome !== "sent" ? { reason: result.reason } : {}) };
  },
};
