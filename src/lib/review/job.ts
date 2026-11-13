import "server-only";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { googleModeFor } from "@/lib/google";
import { isLinked } from "@/lib/google/connections";
import { PermanentJobError, type JobHandler } from "@/lib/queue/registry";
import { enqueue, type QueueJob } from "@/lib/queue/store";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { SEND_CLAIM_STALE_MINUTES, type Part } from "./config";
import { isContinue, registeredParts, runnerFor } from "./parts";
import { autoReviewAllowed, canClaimSend, deadlineFrom, factsFromParts, firstNameOf, firstParts, hasContent, partsAfter, readyToSend, type ReviewFacts } from "./rules";
import { receiptHandler, scheduleReceipt } from "./receipt";
import { releaseReplyHandler } from "./replies";
import type { BusinessReview, PartRecord } from "./types";

// The business review (supabase/058_business_review.sql):
//   startBusinessReview   one row per restaurant (unique), then the start job
//   business_review       queues the parts (each its own job, side by side) and
//                         the send at the 10-minute deadline
//   business_review_part  one part; when it finishes, the parts after it are
//                         queued, and the review is sent if everything is in
//   business_review_send  the deadline: sends with whatever is ready
// A part that fails is retried once, then its section drops out and the builder
// is told (the worker's dead-job alert); the owner never hears about it.

export type StartedBy = "onboarding" | "builder" | "test";
export type StartOutcome = { started: true; reviewId: string } | { started: false; reason: "not_open" | "already" | "no_restaurant" };

const db = () => getSupabase();

async function loadRestaurant(id: string) {
  return check(await db().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}

export async function reviewFor(restaurantId: string) {
  return check(await db().from("business_reviews").select("*").eq("restaurant_id", restaurantId).maybeSingle<BusinessReview>());
}

async function reviewById(id: string) {
  return check(await db().from("business_reviews").select("*").eq("id", id).maybeSingle<BusinessReview>());
}

async function partRows(reviewId: string) {
  return (check(await db().from("business_review_parts").select("*").eq("review_id", reviewId)) ?? []) as PartRecord[];
}

// Google counts as connected when the restaurant has linked its location, or (on
// dummy Google) when it has a dummy profile to work on that isn't marked
// { connected: false } (a test site with only public Places data).
export async function reviewGoogleConnected(r: Restaurant) {
  if (isLinked(r)) return true;
  const p = r.dummy_google_profile as { connected?: boolean } | null | undefined;
  return (await googleModeFor(r.id)) === "dummy" && Boolean(p) && p!.connected !== false;
}

// Starts the review once per restaurant. From onboarding: only where it's open
// (lib/review/config.ts). The builder (admin console) and the test command can
// run it for any site with force, which replaces the old review (its drafts stay).
export async function startBusinessReview(restaurantId: string, by: StartedBy, opts: { force?: boolean } = {}): Promise<StartOutcome> {
  const r = await loadRestaurant(restaurantId);
  if (!r) return { started: false, reason: "no_restaurant" };
  if (by === "onboarding" && !autoReviewAllowed(r)) return { started: false, reason: "not_open" };
  if (opts.force) check(await db().from("business_reviews").delete().eq("restaurant_id", restaurantId));
  // One per restaurant (unique): a second start, however close, finds it there.
  const { data, error } = await db().from("business_reviews").insert({ restaurant_id: restaurantId, status: "queued", started_by: by }).select("id");
  if (error?.code === "23505") return { started: false, reason: "already" };
  if (error) throw new Error(error.message);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error("The business review row wasn't saved");
  try {
    await enqueue({ type: "business_review", restaurantId, key: `business_review:${id}`, payload: { reviewId: id } });
  } catch (err) {
    // Not queued: take the row away again, so a later start isn't blocked by it.
    await db().from("business_reviews").delete().eq("id", id);
    throw err;
  }
  await logAction({
    restaurantId,
    actor: by === "builder" ? "builder" : "system",
    action: "business_review",
    detail: by === "onboarding" ? "Business review started (setup finished)" : by === "builder" ? "Business review started by the builder" : "Business review started (test command)",
  });
  return { started: true, reviewId: id };
}

// Started from setup finishing: never in the way of finishing. A problem (e.g.
// supabase/058 not run yet) tells the builder and setup carries on.
export async function startAfterOnboarding(restaurantId: string) {
  try {
    return (await startBusinessReview(restaurantId, "onboarding")).started;
  } catch (err) {
    console.error("Couldn't start the business review", err);
    await alertBuilder("business-review-start", `The business review couldn't start for restaurant ${restaurantId}: ${err instanceof Error ? err.message : String(err)}. (Has supabase/058_business_review.sql been run?)`).catch(() => undefined);
    return false;
  }
}

const partKey = (reviewId: string, part: Part) => `business_review_part:${reviewId}:${part}`;
const enqueuePart = (review: Pick<BusinessReview, "id" | "restaurant_id">, part: Part) =>
  enqueue({ type: "business_review_part", restaurantId: review.restaurant_id, key: partKey(review.id, part), payload: { reviewId: review.id, part } });

async function beginReview(reviewId: string, now: Date) {
  const review = await reviewById(reviewId);
  if (!review) return { skipped: "the review is gone" };
  if (review.status !== "queued") return { skipped: `already ${review.status}` };
  const r = await loadRestaurant(review.restaurant_id);
  if (!r) throw new PermanentJobError("The restaurant is gone");
  const connected = await reviewGoogleConnected(r);
  const deadline = deadlineFrom(now);
  const parts = registeredParts();
  if (parts.length) {
    // All at once, so a retry finds them all there (duplicate) or none.
    const { error } = await db().from("business_review_parts").insert(parts.map((part) => ({ review_id: review.id, restaurant_id: review.restaurant_id, part, status: "queued" })));
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  check(
    await db()
      .from("business_reviews")
      .update({ status: "running", started_at: now.toISOString(), deadline_at: deadline.toISOString(), google_connected: connected, updated_at: now.toISOString() })
      .eq("id", review.id)
      .eq("status", "queued"),
  );
  for (const part of firstParts(parts)) await enqueuePart(review, part);
  await enqueue({ type: "business_review_send", restaurantId: review.restaurant_id, key: `business_review_send:${review.id}`, payload: { reviewId: review.id }, runAt: deadline });
  if (!parts.length) await sendIfReady(review.id, now);
  return { parts, connected };
}

async function finishPart(review: BusinessReview, part: Part, outcome: "done" | "failed", values: { result?: unknown; error?: string }) {
  const now = new Date().toISOString();
  check(
    await db()
      .from("business_review_parts")
      .update({ status: outcome, result: values.result ?? null, error: values.error ?? null, finished_at: now })
      .eq("review_id", review.id)
      .eq("part", part)
      .eq("status", "queued"),
  );
  const { run, skip } = partsAfter(part, outcome, registeredParts());
  for (const p of skip) check(await db().from("business_review_parts").update({ status: "skipped", error: `needs ${part}`, finished_at: now }).eq("review_id", review.id).eq("part", p).eq("status", "queued"));
  for (const p of run) await enqueuePart(review, p);
}

async function runPart(job: QueueJob) {
  const reviewId = String(job.payload.reviewId ?? "");
  const part = String(job.payload.part ?? "") as Part;
  const review = await reviewById(reviewId);
  if (!review) return { skipped: "the review is gone" };
  const row = (await partRows(review.id)).find((p) => p.part === part);
  if (!row || row.status !== "queued") return { skipped: `part ${part} is ${row?.status ?? "missing"}` };
  const runner = runnerFor(part);
  if (!runner) throw new PermanentJobError(`No runner for part ${part}`);
  const r = await loadRestaurant(review.restaurant_id);
  if (!r) throw new PermanentJobError("The restaurant is gone");
  const round = Number(job.payload.round ?? 0);
  const out = await runner({ review, restaurant: r, now: new Date(), connected: review.google_connected ?? false, round });
  if (isContinue(out)) {
    // More to do: what it has so far is saved (the message can use it at the
    // deadline), and the same part runs again as a new job.
    check(await db().from("business_review_parts").update({ result: out.result }).eq("review_id", review.id).eq("part", part).eq("status", "queued"));
    await enqueue({ type: "business_review_part", restaurantId: review.restaurant_id, key: `${partKey(review.id, part)}:${round + 1}`, payload: { reviewId: review.id, part, round: round + 1 } });
    return { part, round, more: true };
  }
  const result = out;
  await finishPart(review, part, "done", { result });
  await sendIfReady(review.id, new Date()).catch((err) => console.error("Couldn't send the business review yet", err));
  return { part, result: result as Record<string, unknown> };
}

async function partDied(job: QueueJob, err: unknown) {
  const review = await reviewById(String(job.payload.reviewId ?? ""));
  if (!review) return;
  const part = String(job.payload.part ?? "") as Part;
  await finishPart(review, part, "failed", { error: err instanceof Error ? err.message : String(err) });
  await sendIfReady(review.id, new Date()).catch((e) => console.error("Couldn't send the business review yet", e));
}

// The link in the message: the full review on the web (behind login).
export const reviewLink = (r: Pick<Restaurant, "slug" | "id">) => `${appUrl()}/review/${r.slug ?? r.id}`;

export async function factsFor(review: BusinessReview, r: Restaurant): Promise<ReviewFacts> {
  const { minutesSavedSince } = await import("./time-saved");
  return factsFromParts(await partRows(review.id), {
    firstName: firstNameOf(r.owner_name),
    restaurant: r.name,
    link: reviewLink(r),
    connected: review.google_connected ?? false,
    minutesSaved: await minutesSavedSince(r.id, review.created_at).catch(() => 0),
  });
}

// Claims the send (only one caller ever wins), writes the message, sends it.
export async function sendIfReady(reviewId: string, now: Date): Promise<string> {
  const review = await reviewById(reviewId);
  if (!review || !canClaimSend(review, now)) return `not sending (${review?.status ?? "gone"})`;
  const parts = await partRows(review.id);
  if (!readyToSend(parts, now, review.deadline_at ? new Date(review.deadline_at) : null)) return "waiting for parts";

  const stale = new Date(now.getTime() - SEND_CLAIM_STALE_MINUTES * 60_000).toISOString();
  const tryClaim = async (from: "running" | "sending") => {
    let q = db().from("business_reviews").update({ status: "sending", claimed_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", review.id).eq("status", from);
    if (from === "sending") q = q.lt("claimed_at", stale);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return Boolean((data as unknown[] | null)?.length);
  };
  const won = (await tryClaim("running")) || (await tryClaim("sending"));
  if (!won) return "someone else is sending";

  try {
    const r = await loadRestaurant(review.restaurant_id);
    if (!r) throw new PermanentJobError("The restaurant is gone");
    const facts = await factsFor(review, r);
    if (!hasContent(facts)) {
      check(await db().from("business_reviews").update({ status: "nothing", facts, updated_at: now.toISOString() }).eq("id", review.id));
      await alertBuilder(`business-review-empty:${review.id}`, `The business review for ${r.name} found nothing to send (every part failed or none are built yet).`);
      return "nothing to send";
    }
    const { writeReviewMessage } = await import("./message");
    const message = await writeReviewMessage(facts, r);
    const { deliverReview } = await import("./deliver");
    const via = await deliverReview(r, review, message, now);
    check(
      await db()
        .from("business_reviews")
        .update({ status: via === "session" ? "sent" : "waiting_window", sent_via: via, sent_at: via === "session" ? now.toISOString() : null, facts, message, updated_at: now.toISOString() })
        .eq("id", review.id),
    );
    if (via === "session") await scheduleReceipt(review.id, r, now).catch((err) => console.error("Couldn't schedule the review receipt", err));
    await logAction({ restaurantId: r.id, actor: "system", action: "business_review", detail: via === "session" ? "Business review sent in the app" : via === "template" ? "Business review ready: template sent, waiting for the owner's reply" : "Business review ready: waiting for the owner's next message (emailed the link)" });
    return via;
  } catch (err) {
    // Not sent: free the claim so the send job's retry can try again.
    await db().from("business_reviews").update({ status: "running", claimed_at: null }).eq("id", review.id).eq("status", "sending");
    throw err;
  }
}

export const REVIEW_HANDLERS: Record<string, JobHandler> = {
  business_review: { run: async (job) => beginReview(String(job.payload.reviewId ?? ""), new Date()) },
  business_review_part: { run: runPart, onDead: partDied },
  business_review_send: { run: async (job) => ({ outcome: await sendIfReady(String(job.payload.reviewId ?? ""), new Date()) }) },
  review_reply_release: releaseReplyHandler,
  business_review_receipt: receiptHandler,
};
