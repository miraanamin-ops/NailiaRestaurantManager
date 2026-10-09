import "server-only";
import {
  captionPhoto,
  rewriteCampaign,
  writeBirthdayCampaign,
  writeReviewReply,
  type RestaurantContext,
} from "@/lib/assistant";
import {
  birthdayWeek,
  createCampaignDraft,
  getCampaignForDraft,
  recipientsFor,
  updateCampaignDraft,
  type CampaignFields,
} from "@/lib/campaigns";
import { checkCampaign, checkDraft } from "@/lib/checker";
import { applyEdit, createDraft, getLearningContext, type Draft, type DraftKind } from "@/lib/drafts";
import { randomDummyReview } from "@/lib/dummy-reviews";
import { draftMessage } from "@/lib/format";
import { google } from "@/lib/google";
import { createPostDraft, postMessage, runReviewCheck, type Send } from "@/lib/google-jobs";
import { downloadTwilioMedia, isSupportedImage, savePostPhoto } from "@/lib/photos";

// The work behind each kind of draft: write it, run the checker, save it, and
// show it to the owner with Approve / Edit / Skip (or hold it for the brief).

// What test commands say when their draft is held for the brief (as the real job would).
export function heldNote(what: string) {
  return `📥 Drafted ${what} and held it for your morning brief, like the scheduled job does. Text *RUN BRIEF* to see the brief now.`;
}

// Every new draft goes through the checker before the owner sees it.
export async function checkCreateAndSend(
  ctx: RestaurantContext,
  input: { kind: DraftKind; content: string; audience: string; request: string; reviewId?: string | null; customerId?: string | null; context?: string },
  send: Send,
  intro = "",
) {
  const checked = await checkDraft(ctx, { kind: input.kind, audience: input.audience, content: input.content, context: input.context });
  const draft = await createDraft({
    restaurantId: ctx.restaurantId,
    kind: input.kind,
    content: checked.content,
    audience: input.audience,
    request: input.request,
    reviewId: input.reviewId,
    customerId: input.customerId,
    checkNotes: checked.notes,
  });
  await send(`${intro}${draftMessage(draft, ctx.restaurant)}`, true);
}

// Edits go through the checker too.
export async function reviseAndSend(ctx: RestaurantContext, draft: Draft, instruction: string, content: string, send: Send) {
  const review = draft.review_id ? ctx.reviews.find((r) => r.id === draft.review_id) : undefined;
  const checked = await checkDraft(ctx, {
    kind: draft.kind,
    audience: draft.audience ?? "Customers",
    content,
    context: review ? `Replying to this ${review.rating}-star review: "${review.text}"` : undefined,
  });
  const updated = await applyEdit(draft, instruction, checked.content, checked.notes);
  await send(draftMessage(updated, ctx.restaurant), true);
}

// New email campaigns go through the campaign checker, then to the owner for approval
// (or, in hold mode, quietly into the morning brief).
export async function campaignCreateAndSend(
  ctx: RestaurantContext,
  fields: CampaignFields,
  request: string,
  send: Send,
  intro = "",
  isBirthday = false,
  mode: "present" | "hold" = "present",
) {
  const checked = await checkCampaign(ctx, fields);
  const { draft } = await createCampaignDraft({
    restaurant: ctx.restaurant,
    fields: checked.fields,
    request,
    checkNotes: checked.notes,
    now: ctx.now,
    isBirthday,
    mode,
  });
  if (draft.waiting_for === "decision") await send(`${intro}${draftMessage(draft, ctx.restaurant)}`, true);
}

// Campaign edits: the AI rewrites the structured campaign, then it's re-checked.
export async function reviseCampaignAndSend(ctx: RestaurantContext, draft: Draft, instruction: string, send: Send) {
  const campaign = await getCampaignForDraft(draft.id);
  if (!campaign) return send("Sorry, I couldn't find that campaign. Could you ask for it again?");
  const learning = await getLearningContext(ctx.restaurantId);
  const rewritten = await rewriteCampaign(ctx, learning, campaign, instruction);
  const checked = await checkCampaign(ctx, rewritten);
  const updated = await updateCampaignDraft({
    restaurant: ctx.restaurant,
    draft,
    campaign,
    fields: checked.fields,
    instruction,
    checkNotes: checked.notes,
    now: ctx.now,
  });
  await send(draftMessage(updated, ctx.restaurant), true);
}

// The weekly birthday email. Runs from the Monday morning job (held for the brief), or BIRTHDAY CAMPAIGN.
export async function proposeBirthdayCampaign(ctx: RestaurantContext, send: Send, mode: "present" | "hold" = "present") {
  const { eligible } = await recipientsFor(ctx.restaurant, "birthdays_7d", ctx.now);
  if (!eligible.length) {
    if (mode === "hold") return; // nothing to approve, so nothing to say
    return send("🎂 No customers with email consent have a birthday in the next 7 days, so there's no birthday email this week.");
  }
  const learning = await getLearningContext(ctx.restaurantId);
  const fields = await writeBirthdayCampaign(ctx, learning);
  await campaignCreateAndSend(
    ctx,
    // Dates and segment are fixed in plain code, not left to the AI.
    { ...fields, segment: "birthdays_7d", ...birthdayWeek(ctx.now) },
    "Weekly birthday email",
    send,
    `🎂 *This week's birthday email* (${eligible.length} customer${eligible.length === 1 ? "" : "s"}: ${eligible.map((c) => c.name.split(/\s+/)[0]).join(", ")})\n\n`,
    true,
    mode,
  );
}

// Test command: a new review "appears on Google" (dummy mode), then the
// normal review check runs straight away instead of waiting for the hour.
export async function newReview(ctx: RestaurantContext, rating: number | null, send: Send) {
  const g = google();
  if (!g.addDummyReview) return send("NEW REVIEW only works in dummy Google mode.");
  const pick = randomDummyReview(rating ?? undefined);
  const review = await g.addDummyReview(ctx.restaurantId, pick);
  const name = review.author_name.replace(/\.$/, "");
  await send(`🌐 A new ${review.rating}-star review from ${name} just appeared on (dummy) Google. Running the review check now…`);
  const result = await runReviewCheck(ctx, send);
  // 1-3 stars: the alert itself was the reply. 4-5 stars: held, as the hourly check would.
  if (result.held) await send(heldNote(`a reply to ${name}'s review`));
}

// The manual fallback: the owner pastes a review from anywhere; they get a
// checked reply to copy into Google themselves. Nothing is posted for them.
export async function pastedReviewReply(
  ctx: RestaurantContext,
  review: { authorName: string; rating: number | null; text: string },
  send: Send,
) {
  const learning = await getLearningContext(ctx.restaurantId);
  const content = await writeReviewReply(ctx, learning, { author_name: review.authorName, rating: review.rating, text: review.text });
  const checked = await checkDraft(ctx, {
    kind: "review_reply",
    audience: `review by ${review.authorName}`,
    content,
    context: `Replying to this ${review.rating ? `${review.rating}-star ` : ""}review: "${review.text}"`,
  });
  const notes = [
    ...checked.notes.fixes.map((f) => `🔍 _Checker fixed: ${f}_`),
    ...checked.notes.flags.map((f) => `⚠️ _Check: ${f}_`),
  ];
  await send(
    `✍️ Here's a reply to ${review.authorName}'s review. *Copy the next message* and paste it as your reply on Google.${notes.length ? `\n\n${notes.join("\n")}` : ""}`,
  );
  // On its own, so it's easy to copy in one go.
  await send(checked.content);
}

// A photo sent on WhatsApp becomes a captioned Google post, waiting for approval.
export async function photoPost(ctx: RestaurantContext, media: { url: string; contentType: string }, note: string, send: Send) {
  if (!isSupportedImage(media.contentType)) {
    return send("I can only turn photos (JPEG, PNG or WebP) into Google posts. Videos and documents aren't supported yet.");
  }
  await send("📷 Got your photo! Writing a caption…");
  const bytes = await downloadTwilioMedia(media.url);
  const photoUrl = await savePostPhoto(ctx.restaurantId, bytes, media.contentType);
  const learning = await getLearningContext(ctx.restaurantId);
  const post = await captionPhoto(ctx, learning, { base64: bytes.toString("base64"), mediaType: media.contentType }, note.trim());
  const draft = await createPostDraft(ctx, { topic: post.topic, text: post.text, photoUrl, request: note || "Photo post", mode: "present" });
  await send(`📷 *Photo post for Google*\n\n${postMessage(draft, post.topic, photoUrl, ctx)}`, true);
}
