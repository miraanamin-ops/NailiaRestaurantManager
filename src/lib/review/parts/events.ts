import "server-only";
import { loadRestaurantContext, writeEventPost, writeOfferCampaign } from "@/lib/assistant";
import { campaignCreateAndSend } from "@/lib/bot/flows";
import { recipientsFor } from "@/lib/campaigns";
import { londonYmd } from "@/lib/clock";
import { check, getLearningContext } from "@/lib/drafts";
import { createPostDraft } from "@/lib/google-jobs";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { CALENDAR_EVENTS, campaignRequest, ramadanProblems, relevantEvents, type CalendarEvent } from "../calendar-events";
import { EVENTS_DAYS } from "../config";
import { logTimeSaved } from "../time-saved";
import type { PartResults } from "../types";
import type { PartContext } from ".";

// The next 30 days: the dates from lib/review/calendar-events.ts (never AI) are
// copied into calendar_events, then for each one this restaurant plans for, the
// campaign writer drafts one email campaign and one Google post, through the
// checks, held as planned work for the guided flow and the brief. With nobody
// on the customer list yet, the emails wait until there are subscribers;
// Google posts can go out on approval.

const MAX_EVENTS = 3; // the next three at most, so the first review stays quick and cheap

export async function syncCalendarEvents() {
  const rows = CALENDAR_EVENTS.map((e) => ({ key: e.key, name: e.name, kind: e.kind, starts_on: e.starts_on, ends_on: e.ends_on ?? null, date_uncertain: e.date_uncertain ?? false, audience: e.audience, source: e.source, notes: e.notes ?? null, updated_at: new Date().toISOString() }));
  check(await getSupabase().from("calendar_events").upsert(rows, { onConflict: "key" }));
}

const tag = async (r: Restaurant, reviewId: string, draftId: string) => check(await getSupabase().from("drafts").update({ business_review_id: reviewId }).eq("id", draftId).eq("restaurant_id", r.id));

// Drafts the campaign and post for these events; returns how many were drafted.
export async function draftForEvents(r: Restaurant, reviewId: string, events: CalendarEvent[]) {
  const ctx = await loadRestaurantContext(r.id, { realTime: true });
  const learning = await getLearningContext(r.id);
  const audiences = r.event_audiences ?? null;
  let drafted = 0;
  for (const e of events) {
    const request = campaignRequest(e, audiences);
    try {
      // The email: written, then the Ramadan rule (code) on top of the usual checks.
      let fields = await writeOfferCampaign(ctx, learning, request);
      if (ramadanProblems(JSON.stringify(fields), e, audiences).length) fields = await writeOfferCampaign(ctx, learning, `${request} Again: this is during Ramadan, so iftar after sunset, never lunch.`);
      if (!ramadanProblems(JSON.stringify(fields), e, audiences).length) {
        const draft = await campaignCreateAndSend(ctx, fields, `Business review: ${e.name}`, async () => {}, "", false, "hold");
        await tag(r, reviewId, draft.id);
        await logTimeSaved(r.id, "campaign_draft", draft.id);
        drafted++;
      }
    } catch (err) {
      console.error(`Couldn't draft the ${e.name} campaign`, err);
    }
    try {
      const post = await writeEventPost(ctx, learning, request);
      if (!ramadanProblems(post.text, e, audiences).length) {
        const draft = await createPostDraft(ctx, { topic: "event", text: post.text, photoUrl: null, request: `Business review: ${e.name}`, mode: "hold" });
        await tag(r, reviewId, draft.id);
        await logTimeSaved(r.id, "google_post", draft.id);
        drafted++;
      }
    } catch (err) {
      console.error(`Couldn't draft the ${e.name} post`, err);
    }
  }
  return drafted;
}

export async function eventsPart(ctx: PartContext): Promise<PartResults["events"]> {
  const r = ctx.restaurant;
  await syncCalendarEvents();
  const events = relevantEvents(CALENDAR_EVENTS, r.event_audiences, londonYmd(ctx.now), EVENTS_DAYS).slice(0, MAX_EVENTS);
  if (!events.length) return { names: [], drafted: 0, emailsHeld: false };
  const subscribers = (await recipientsFor(r, "everyone", ctx.now)).eligible.length;
  const drafted = await draftForEvents(r, ctx.review.id, events);
  return { names: events.map((e) => e.name), drafted, emailsHeld: subscribers === 0 };
}
