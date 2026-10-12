import "server-only";
import { answerWithInsights, insightsMode, queueInsightsShadow } from "@/lib/agents/insights";
import { chat, rewriteDraft, type ChatResult, type StoredMessage } from "@/lib/assistant";
import { londonYmd } from "@/lib/clock";
import { getActiveDraft, getLearningContext, saveSkipReason } from "@/lib/drafts";
import { presentNext } from "@/lib/google-jobs";
import { getRestaurant } from "@/lib/onboarding/store";
import { applyProfileChanges } from "@/lib/profile-edits";
import { getSupabase } from "@/lib/supabase";
import { decideOnScreen, decideTargeted } from "./decisions";
import { campaignCreateAndSend, checkCreateAndSend, pastedReviewReply, reviseAndSend, reviseCampaignAndSend } from "./flows";
import { answerHoursQuestion, hoursForQuestion } from "./hours-questions";
import { looksLikeNumbersQuestion, parseAction, parseHoursAnswer, parseQuestionAnswer, parseTargetedAction } from "./parse";
import { answerQuestion } from "./questions";
import type { Turn } from "./turn";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;

// Anything that isn't a command: a decision, an edit, a skip reason, or a chat with Claude.
export async function handleConversation(turn: Turn, body: string, buttonPayload: string | undefined) {
  const { ctx, owner, send } = turn;
  const [active, learning] = await Promise.all([getActiveDraft(ctx.restaurantId), getLearningContext(ctx.restaurantId)]);
  // A question about a review: Reply publicly / Handle privately / Both (a button,
  // "PUBLIC 2", or a plain answer while the question is on screen).
  const questionOnScreen = active?.kind === "review_question" && active.waiting_for === "decision";
  const answer = parseQuestionAnswer(buttonPayload, body, questionOnScreen);
  if (answer) return answerQuestion(turn, answer, questionOnScreen ? active : null);
  // A bank holiday coming up: Same hours / Closed / Different hours, then (Different) the hours.
  const hoursOnScreen = active?.kind === "hours_question" && active.waiting_for === "decision";
  const hoursAnswer = parseHoursAnswer(buttonPayload, body, hoursOnScreen);
  if (hoursAnswer) return answerHoursQuestion(turn, hoursAnswer, hoursOnScreen ? active : null);
  if (active?.kind === "hours_question" && active.waiting_for === "edit_instructions") return hoursForQuestion(turn, active, body);

  const targeted = parseTargetedAction(buttonPayload, body);
  if (targeted) return decideTargeted(turn, targeted);

  const action = parseAction(buttonPayload, body);
  if (action && (await decideOnScreen(turn, action, active, Boolean(buttonPayload)))) return;

  // The owner is telling us what to change.
  if (active?.waiting_for === "edit_instructions") {
    if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, body, send);
    const rewritten = await rewriteDraft(ctx, learning, active, body);
    return reviseAndSend(ctx, active, body, rewritten, send);
  }

  // The owner is telling us why they skipped.
  if (active?.waiting_for === "skip_reason") {
    await saveSkipReason(active, body);
    await send("Thanks, noted. I'll keep that in mind for next time. 🙏");
    await presentNext(ctx, send);
    return;
  }

  // A question about the numbers: Insights answers it when it's live (today's
  // assistant answers if Insights can't). In shadow mode it answers in the
  // background, next to today's answer, for the /log comparison.
  const numbers = !buttonPayload && looksLikeNumbersQuestion(body) ? await insightsMode(ctx.restaurant) : "off";
  if (numbers === "live" && (await answerWithInsights(ctx.restaurant, body, ctx.now, send))) return;

  // Anything else: a normal chat, which may produce a new or revised draft.
  const { data: rows, error } = await getSupabase()
    .from("messages")
    .select("direction, body, status")
    // This restaurant's own conversation only.
    .eq("restaurant_id", ctx.restaurantId)
    // Quoted because numbers look like "whatsapp:+44…" and ":" is special in this filter.
    .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT)
    .returns<StoredMessage[]>();
  if (error) throw new Error(error.message);

  const result = await chat(ctx, learning, active, (rows ?? []).reverse());
  await respond(turn, body, result, active);
  if (numbers === "shadow") {
    await queueInsightsShadow(ctx.restaurant, { task: "answer", question: body, today: londonYmd(ctx.now), legacy_text: legacyAnswer(result) }, `insights:question:${ctx.restaurantId}:${Date.now()}`);
  }
}

// What today's assistant did with the message, in a line (for the Insights comparison).
function legacyAnswer(result: ChatResult) {
  switch (result.type) {
    case "text":
      return result.text;
    case "draft":
      return `(drafted a ${result.kind.replace("_", " ")} for approval) ${result.content}`;
    case "campaign":
      return `(drafted an email campaign: ${result.fields.name}, ${result.fields.offer})`;
    case "pasted_review":
      return "(drafted a reply to a pasted review)";
    case "profile_changes":
      return "(changed the restaurant's details)";
    case "revise":
      return `(revised the draft on screen) ${result.content}`;
  }
}

async function respond(turn: Turn, body: string, result: ChatResult, active: Awaited<ReturnType<typeof getActiveDraft>>) {
  const { ctx, send } = turn;
  if (result.type === "draft") {
    return checkCreateAndSend(
      ctx,
      { kind: result.kind, content: result.content, audience: result.audience, request: body, reviewId: result.reviewId, customerId: result.customerId },
      send,
    );
  }
  if (result.type === "campaign") return campaignCreateAndSend(ctx, result.fields, body, send);
  if (result.type === "pasted_review") return pastedReviewReply(ctx, result, send);
  if (result.type === "profile_changes") return send(await applyProfileChanges(await getRestaurant(ctx.restaurantId), result.changes));
  if (result.type === "revise" && active?.waiting_for === "decision") {
    if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, result.instruction, send);
    return reviseAndSend(ctx, active, result.instruction, result.content, send);
  }
  if (result.type === "text") return send(result.text);
  return send("Sorry, I lost track of that draft. Could you ask again?");
}
