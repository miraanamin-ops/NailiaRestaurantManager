import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { proposeBirthdayCampaign } from "@/lib/bot/flows";
import { canMessageFreely, markBriefWaiting, sendBrief } from "@/lib/brief";

import { formatLondon, londonParts, londonWeekday, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { queueResultsMessage } from "@/lib/format";
import { ownerChannel } from "@/lib/followups";
import { runPostJob } from "@/lib/google-jobs";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { createReport, reportPeriod } from "@/lib/report/build";
import { processQueue } from "@/lib/send";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The morning job: everything that happens once a day at 9am UK time, ending
// in one brief to the owner (plus the report link on Mondays).
//
// Safe to fail: each step is marked done only once it has worked, so if anything
// goes wrong the next hourly run picks up where it stopped. The owner hears
// about it once, and after MAX_FAILURES tries in a day it stops retrying.
export const BRIEF_HOUR = 9;
const MAX_FAILURES = 3;
// Long enough for a full run (Claude writes drafts and the report), short enough
// that a crashed run doesn't block the next hour's retry.
const LOCK_MINUTES = 10;

async function setFields(r: Restaurant, fields: Partial<Restaurant>) {
  check(await getSupabase().from("restaurants").update(fields).eq("id", r.id));
}

// Only one run at a time (the hourly and daily jobs can overlap): a short lock,
// taken in a single update so two runs can't both get it.
async function takeLock(r: Restaurant, now: Date) {
  const res = await getSupabase()
    .from("restaurants")
    .update({ morning_lock_until: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() })
    .eq("id", r.id)
    .or(`morning_lock_until.is.null,morning_lock_until.lt.${now.toISOString()}`)
    .select("id");
  return (check(res) ?? []).length > 0;
}

// This Monday's report, if the morning job has made it (it covers last Monday to Sunday,
// so a report asked for with RUN REPORT never matches).
async function mondayReportHeadline(r: Restaurant, due: Date) {
  if (r.last_report_on !== londonYmd(due)) return null;
  const row = check(
    await getSupabase()
      .from("reports")
      .select("headline")
      .eq("restaurant_id", r.id)
      .eq("period_end", reportPeriod(due, true).end.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ headline: string }>(),
  );
  return row?.headline ?? null;
}

export async function runMorning(restaurant: Restaurant, now: Date) {
  const today = londonYmd(now);
  if (londonParts(now).hour < BRIEF_HOUR) return { skipped: "before 9am" };
  if (restaurant.last_brief_on === today) return { skipped: "already done today" };
  const failuresToday = restaurant.morning_failed_on === today ? restaurant.morning_failures : 0;
  if (failuresToday >= MAX_FAILURES) return { skipped: `gave up after ${MAX_FAILURES} failed tries today` };
  if (!(await takeLock(restaurant, now))) return { skipped: "another run is in progress" };

  const done: string[] = [];
  let r = restaurant;
  try {
    // 1. Approved drafts held overnight (outside sending hours) go out now.
    //    Safe to repeat: anything already sent is never sent twice.
    const released = await processQueue(r, now);
    done.push(`released ${released.length}`);

    const ctx = await loadRestaurantContext({ realTime: true });
    r = ctx.restaurant;
    const weekday = londonWeekday(now);
    const silent = async () => {}; // drafts made here are held for the brief, not messaged

    // 2. Monday: this week's birthday email. Monday and Thursday: a Google post.
    if (weekday === 1 && r.last_birthday_campaign_on !== today) {
      await proposeBirthdayCampaign(ctx, silent, "hold");
      await setFields(r, { last_birthday_campaign_on: today });
      done.push("birthday email");
    }
    if ([1, 4].includes(weekday) && r.last_post_draft_on !== today) {
      await runPostJob(ctx);
      await setFields(r, { last_post_draft_on: today });
      done.push("Google post");
    }

    // 3. Monday: last week's report.
    if (weekday === 1 && r.last_report_on !== today) {
      await createReport(ctx, reportPeriod(now, true));
      await setFields(r, { last_report_on: today });
      r = { ...r, last_report_on: today };
      done.push("report");
    }

    // 4. The brief itself.
    const channel = ownerChannel(r);
    let brief: unknown = "no owner WhatsApp yet";
    if (channel && !(await canMessageFreely(r, now))) {
      await markBriefWaiting(r, now);
      brief = "waiting for the owner to message (24h rule)";
    } else if (channel) {
      brief = await sendBrief(r, channel, now, { extra: released.length ? [queueResultsMessage(released)] : [] });
      const headline = await mondayReportHeadline(r, now);
      if (headline) await messageOwner(channel, headline);
    }
    await setFields(r, { last_brief_on: today, morning_failures: 0, morning_failed_on: null, morning_lock_until: null });
    return { done, brief };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Morning job failed", { done, error: message });
    const failures = failuresToday + 1;
    await setFields(r, { morning_failures: failures, morning_failed_on: today, morning_lock_until: null });
    await tellOwner(r, now, failures);
    return { done, error: message, failures };
  }
}

// One message on the first failure, one when giving up. Nothing in between.
async function tellOwner(r: Restaurant, now: Date, failures: number) {
  const channel = ownerChannel(r);
  if (!channel || (failures !== 1 && failures !== MAX_FAILURES)) return;
  try {
    if (!(await canMessageFreely(r, now))) return;
    const next = new Date(now.getTime() + 60 * 60_000);
    await messageOwner(
      channel,
      failures === 1
        ? `⚠️ Something went wrong putting together this morning's brief. Nothing was sent to customers. I'll try again at about ${formatLondon(next).replace(/:\d\d/, ":05")}.`
        : `⚠️ I couldn't put together this morning's brief after ${MAX_FAILURES} tries, so I've stopped for today. Nothing was sent to customers. Text *RUN BRIEF* to see what's waiting.`,
    );
  } catch (err) {
    console.error("Couldn't tell the owner the morning job failed", err);
  }
}

// The owner just messaged and this morning's brief was waiting for them.
export async function deliverWaitingBrief(r: Restaurant, channel: OwnerChannel, now: Date) {
  if (!r.brief_waiting_since) return;
  const note = "_This morning's brief, held until you messaged (WhatsApp only lets me message you within 24 hours of your last message)._";
  const outcome = await sendBrief(r, channel, now, { note });
  if (!outcome.sent) check(await getSupabase().from("restaurants").update({ brief_waiting_since: null }).eq("id", r.id));
  const headline = await mondayReportHeadline(r, new Date(r.brief_waiting_since));
  if (headline) await messageOwner(channel, headline);
}
