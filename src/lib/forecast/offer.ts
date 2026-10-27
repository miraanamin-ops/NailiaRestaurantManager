import "server-only";
import { growthMode, liveGrowthRequest, queueGrowthShadow } from "@/lib/agents/growth";
import { writeOfferCampaign } from "@/lib/assistant";
import { campaignCreateAndSend } from "@/lib/bot/flows";
import type { OfferTap } from "@/lib/bot/parse";
import type { Turn } from "@/lib/bot/turn";
import { calendarSuggestionById, markSuggestion } from "@/lib/calendar-lines";
import { londonYmd } from "@/lib/clock";
import { getLearningContext } from "@/lib/drafts";
import { daysBetween } from "@/lib/sales/format";
import { forecastBriefById, latestOpenOffer, markOffer } from "./index";
import { longDay, offerRequest, weekdayName, type Flag } from "./rules";

// The owner answered the brief's quiet-night offer. "Draft an offer" runs the same
// campaign flow as a typed "Thursday is quiet" (Growth when it's live), so every
// rule still applies: approval, discount cap, consent, sending hours, the 7-day gap.
// Returns false when a typed DRAFT OFFER has no open offer (it's then an ordinary message).
export async function answerOfferTap(turn: Turn, tap: OfferTap) {
  const { ctx, send } = turn;
  const today = londonYmd(ctx.now);
  const row = tap.id ? await forecastBriefById(ctx.restaurantId, tap.id) : await latestOpenOffer(ctx.restaurantId, today);
  // Not a quiet-night offer: a calendar line's campaign idea (same buttons).
  if (!row && tap.id) {
    const idea = await calendarSuggestionById(ctx.restaurantId, tap.id);
    if (idea) return answerCalendarIdea(turn, idea, tap.yes);
  }
  if (!row?.offer) {
    if (!tap.id) return false;
    await send("That offer isn't waiting any more.");
    return true;
  }
  const offer = row.offer;
  const day = weekdayName(offer.day);
  if (offer.status === "drafted") {
    await send(`I've already drafted the offer for ${day}: it's in your messages above.`);
    return true;
  }
  if (offer.day <= today) {
    await send(`${longDay(offer.day)} is already here, so it's too late for an offer email for it.`);
    return true;
  }
  if (!tap.yes) {
    await markOffer(ctx.restaurantId, row.id, { status: "declined", decided_at: ctx.now.toISOString() });
    await send(`OK, no offer for ${day}.`);
    return true;
  }

  const flag: Flag = { day: offer.day, offset: daysBetween(today, offer.day), kind: "quiet", pct: offer.pct, likely: offer.likely, normal: offer.normal, reason: offer.reason };
  const request = offerRequest(flag);
  const growth = await growthMode(ctx.restaurant);
  if (growth === "live" && (await liveGrowthRequest(ctx.restaurant, request, ctx.now, send))) {
    await markOffer(ctx.restaurantId, row.id, { status: "drafted", decided_at: ctx.now.toISOString() });
    return true;
  }
  const fields = await writeOfferCampaign(ctx, await getLearningContext(ctx.restaurantId), request);
  const draft = await campaignCreateAndSend(ctx, fields, request, send, `📧 Here's an offer for ${longDay(offer.day)}:\n\n`);
  await markOffer(ctx.restaurantId, row.id, { status: "drafted", draft_id: draft.id, decided_at: ctx.now.toISOString() });
  // Shadow: Growth drafts its own for the same ask, next to this one on /log.
  if (growth === "shadow") await queueGrowthShadow(ctx.restaurant, { task: "owner_request", request, today, legacy_draft_id: draft.id, legacy_text: draft.content });
  return true;
}

// "Draft an offer" under a calendar line: the same campaign flow, with the idea's request.
async function answerCalendarIdea(turn: Turn, idea: Awaited<ReturnType<typeof calendarSuggestionById>> & object, yes: boolean) {
  const { ctx, send } = turn;
  const today = londonYmd(ctx.now);
  if (idea.status === "drafted") {
    await send(`I've already drafted that one: it's in your messages above.`);
    return true;
  }
  if (idea.day <= today) {
    await send(`${idea.title} is already here, so it's too late for an email about it.`);
    return true;
  }
  if (!yes) {
    await markSuggestion(ctx.restaurantId, idea.id, { status: "declined", decided_at: ctx.now.toISOString() });
    await send("OK, no email for that one.");
    return true;
  }
  const growth = await growthMode(ctx.restaurant);
  if (growth === "live" && (await liveGrowthRequest(ctx.restaurant, idea.request, ctx.now, send))) {
    await markSuggestion(ctx.restaurantId, idea.id, { status: "drafted", decided_at: ctx.now.toISOString() });
    return true;
  }
  const fields = await writeOfferCampaign(ctx, await getLearningContext(ctx.restaurantId), idea.request);
  const draft = await campaignCreateAndSend(ctx, fields, idea.request, send, `📧 Here's an email for ${idea.title} (${longDay(idea.day)}):\n\n`);
  await markSuggestion(ctx.restaurantId, idea.id, { status: "drafted", draft_id: draft.id, decided_at: ctx.now.toISOString() });
  if (growth === "shadow") await queueGrowthShadow(ctx.restaurant, { task: "owner_request", request: idea.request, today, legacy_draft_id: draft.id, legacy_text: draft.content });
  return true;
}
