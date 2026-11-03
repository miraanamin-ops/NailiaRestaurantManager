import "server-only";
import { canMessageFreely } from "@/lib/brief";
import { check } from "@/lib/drafts";
import { sendOwnerEmail } from "@/lib/email";
import { ownerChannel } from "@/lib/followups";
import { sendAndLog, type OwnerChannel } from "@/lib/notify";
import { isSandbox } from "@/lib/onboarding/channel";
import { PermanentJobError } from "@/lib/queue/registry";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { sendDinaChoices, sendReviewReadyTemplate } from "@/lib/whatsapp";
import { FLOW_PREFIX } from "./config";
import type { BusinessReview } from "./types";
import { firstNameOf } from "./rules";

// Getting the business review to the owner (WhatsApp's 24-hour rule):
//   they messaged us in the last 24 hours   the review, as a normal message,
//                                           with a "Let's go" button
//   they haven't, on a real WhatsApp sender the approved template ("Your DinerAI
//                                           business review is ready") with a
//                                           button; the review follows their tap
//   they haven't, on the sandbox            (templates can't be sent there) it
//                                           waits for their next message, and the
//                                           link is emailed to them
// Waiting reviews go out on the owner's next message (deliverWaitingReview,
// called from lib/bot/index.ts).

export type Via = "session" | "template" | "waiting";

export const goButtonId = (reviewId: string) => `${FLOW_PREFIX}${reviewId}:go`;

export async function sendReviewMessage(channel: OwnerChannel, reviewId: string, message: string) {
  await sendAndLog(channel, () => sendDinaChoices(channel.from, channel.to, { kind: "buttons", body: message, options: [{ id: goButtonId(reviewId), title: "Let's go", description: "" }] }), message);
}

export async function deliverReview(r: Restaurant, review: Pick<BusinessReview, "id">, message: string, now: Date): Promise<Via> {
  const channel = ownerChannel(r);
  if (!channel) throw new PermanentJobError("The owner's WhatsApp isn't linked");
  if (await canMessageFreely(r, now)) {
    await sendReviewMessage(channel, review.id, message);
    return "session";
  }
  if (!isSandbox()) {
    const name = firstNameOf(r.owner_name) ?? "there";
    await sendAndLog(channel, () => sendReviewReadyTemplate(channel.from, channel.to, name), `Your DinerAI business review is ready, ${name}. [See my review]`);
    return "template";
  }
  await emailReviewLink(r, message).catch((err) => console.error("Couldn't email the business review link", err));
  return "waiting";
}

async function emailReviewLink(r: Restaurant, message: string) {
  const link = message.match(/https?:\/\/\S+/)?.[0] ?? "";
  const name = firstNameOf(r.owner_name);
  const text = [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    `Your DinerAI business review for ${r.name} is ready. Send me any message on WhatsApp and I'll show it to you there, one thing at a time.`,
    "",
    ...(link ? [`Or see it in full here: ${link}`, ""] : []),
    "Dina",
  ].join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1c1917">${esc(text)
    .replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
  await sendOwnerEmail(r, { subject: `Your business review for ${r.name} is ready`, text, html, kind: "business_review" });
}

// The owner has just messaged: a review waiting for that goes out now (once:
// only the first caller moves it from waiting to sent). True if it was sent.
export async function deliverWaitingReview(restaurant: Restaurant, channel: OwnerChannel, now: Date): Promise<boolean> {
  let review: BusinessReview | null;
  try {
    review = check(await getSupabase().from("business_reviews").select("*").eq("restaurant_id", restaurant.id).eq("status", "waiting_window").maybeSingle<BusinessReview>());
  } catch {
    return false; // before supabase/058: nothing can be waiting
  }
  if (!review?.message) return false;
  const { data, error } = await getSupabase()
    .from("business_reviews")
    .update({ status: "sent", sent_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", review.id)
    .eq("status", "waiting_window")
    .select("id");
  if (error || !(data as unknown[] | null)?.length) return false;
  await sendReviewMessage(channel, review.id, review.message);
  return true;
}
