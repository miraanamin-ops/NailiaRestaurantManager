import "server-only";
import { growthMode, liveGrowthRequest, queueGrowthShadow } from "@/lib/agents/growth";
import { gmMode, legacyRoute, queueGmShadow } from "@/lib/agents/gm";
import { answerAgentQuestion, answerChoice, correctFact, decideIdea, gmLive, localEventCard, saveReasonTap } from "@/lib/agents/gm-live";
import { answerWithInsights, insightsMode, queueInsightsShadow } from "@/lib/agents/insights";
import { chat, rewriteDraft, type ChatResult, type StoredMessage } from "@/lib/assistant";
import { londonYmd } from "@/lib/clock";
import { check, getActiveDraft, getLearningContext, saveSkipReason, type Draft } from "@/lib/drafts";
import { presentNext } from "@/lib/google-jobs";
import { getRestaurant } from "@/lib/onboarding/store";
import { applyProfileChanges } from "@/lib/profile-edits";
import { getSupabase } from "@/lib/supabase";
import { decideOnScreen, decideTargeted } from "./decisions";
import { campaignCreateAndSend, checkCreateAndSend, pastedReviewReply, reviseAndSend, reviseCampaignAndSend } from "./flows";
import { answerHoursQuestion, hoursForQuestion } from "./hours-questions";
import { looksLikeForecastQuestion, looksLikeNumbersQuestion, parseAction, parseGmTap, parseHoursAnswer, parseOfferTap, parseQuestionAnswer, parseTargetedAction } from "./parse";
import { answerOfferTap } from "@/lib/forecast/offer";
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

  // The GM's own cards: "which did you mean?", a special idea, a one-tap skip reason.
  let message = body;
  const tap = parseGmTap(buttonPayload, body, active?.waiting_for === "decision" ? active.kind : null);
  if (tap) {
    const draft = tap.draftId
      ? check(await getSupabase().from("drafts").select("*").eq("restaurant_id", ctx.restaurantId).eq("id", tap.draftId).maybeSingle<Draft>())
      : active;
    if (!draft) return send("That isn't waiting for an answer any more.");
    if (tap.kind === "reason") {
      const reason = await saveReasonTap(draft, tap.n);
      return send(reason ? "Thanks, noted. 🙏" : "Thanks.");
    }
    if (tap.kind === "idea") return decideIdea(turn, draft, tap.like);
    const chosen = await answerChoice(turn, draft, tap.n);
    if (chosen.handled) return;
    // Not handled live: today's assistant answers the original message.
    message = chosen.message;
  }
  // The brief's quiet-night offer: Draft an offer / Not now.
  const offerTap = parseOfferTap(buttonPayload, body);
  if (offerTap && (await answerOfferTap(turn, offerTap))) return;
  const gmOn = (await gmMode(ctx.restaurant)) === "live";
  // A question from scheduled work (Growth, Insights), answered in words while it's on screen.
  if (gmOn && !buttonPayload && active?.kind === "agent_question" && active.waiting_for === "decision") return answerAgentQuestion(turn, active, body);

  const targeted = parseTargetedAction(buttonPayload, body);
  if (targeted) return decideTargeted(turn, targeted);

  const action = parseAction(buttonPayload, body);
  if (action && (await decideOnScreen(turn, action, active, Boolean(buttonPayload)))) return;

  // The owner is telling us what to change.
  if (active?.waiting_for === "edit_instructions") {
    if (active.kind === "profile_change") return correctFact(turn, active, body);
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
  // The GM live: it routes the message and answers it if a live part of the system
  // can; otherwise (chat, look-ups, a specialist in shadow) today's assistant does.
  // A question about the forecast goes straight to today's assistant, which has
  // look_up_forecast (Insights and the GM's router don't read forecasts yet).
  const forecastQuestion = !buttonPayload && looksLikeForecastQuestion(body);
  if (gmOn && !buttonPayload && !forecastQuestion && message === body && (await gmLive(turn, body, active))) return;

  const started = Date.now();
  const onScreen = active?.waiting_for === "decision" ? `${active.kind.replace(/_/g, " ")} for ${active.audience ?? "the owner"}` : null;
  // (With the GM live, its router spots number questions instead of this word list.)
  const numbers = !gmOn && !buttonPayload && !forecastQuestion && looksLikeNumbersQuestion(body) ? await insightsMode(ctx.restaurant) : "off";
  if (numbers === "live" && (await answerWithInsights(ctx.restaurant, body, ctx.now, send))) {
    // The GM in shadow: its route for the same message, next to today's.
    await queueGmShadow(ctx.restaurant, { message: body, owner, legacy_route: "insights", legacy_text: "(Insights answered)", legacy_ms: Date.now() - started, on_screen: onScreen });
    return;
  }

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

  const history = (rows ?? []).reverse();
  // After "which did you mean?", today's assistant answers the original message.
  if (message !== body) history.push({ direction: "inbound", body: message, status: "received" });
  const result = await chat(ctx, learning, active, history);
  await respond(turn, message, result, active);
  // The GM in shadow: its route for the same message, next to what today's code did (and how long it took).
  if (!buttonPayload) await queueGmShadow(ctx.restaurant, { message: body, owner, legacy_route: legacyRoute(result), legacy_text: legacyAnswer(result), legacy_ms: Date.now() - started, on_screen: onScreen });
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
    case "local_event":
      return `(offered to add ${result.event.name} on ${result.event.day} to the local calendar)`;
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
  if (result.type === "campaign") {
    // Growth live: it drafts the campaign instead (today's flow if it can't).
    const growth = await growthMode(ctx.restaurant);
    if (growth === "live" && (await liveGrowthRequest(ctx.restaurant, body, ctx.now, send))) return;
    const draft = await campaignCreateAndSend(ctx, result.fields, body, send);
    // Shadow: Growth drafts its own campaign for the same ask, next to today's on /log.
    if (growth === "shadow") await queueGrowthShadow(ctx.restaurant, { task: "owner_request", request: body, today: londonYmd(ctx.now), legacy_draft_id: draft.id, legacy_text: draft.content });
    return;
  }
  if (result.type === "pasted_review") return pastedReviewReply(ctx, result, send);
  if (result.type === "profile_changes") return send(await applyProfileChanges(await getRestaurant(ctx.restaurantId), result.changes));
  if (result.type === "local_event") return localEventCard(turn, body, result.event);
  if (result.type === "revise" && active?.waiting_for === "decision") {
    if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, result.instruction, send);
    return reviseAndSend(ctx, active, result.instruction, result.content, send);
  }
  if (result.type === "text") return send(result.text);
  return send("Sorry, I lost track of that draft. Could you ask again?");
}
