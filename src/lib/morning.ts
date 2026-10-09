import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { proposeBirthdayCampaign } from "@/lib/bot";
import { canMessageFreely, markBriefWaiting, sendBrief } from "@/lib/brief";
import { londonDate } from "@/lib/campaigns";
import { londonParts } from "@/lib/clock";
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
export const BRIEF_HOUR = 9;

export function londonWeekday(now: Date) {
  const p = londonParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
}

// One brief a day: claims today in a single update, so the hourly and daily
// jobs can't both send it.
async function claimToday(r: Restaurant, today: string) {
  const res = await getSupabase()
    .from("restaurants")
    .update({ last_brief_on: today })
    .eq("id", r.id)
    .or(`last_brief_on.is.null,last_brief_on.neq.${today}`)
    .select("id");
  return (check(res) ?? []).length > 0;
}

export async function runMorning(r: Restaurant, now: Date) {
  const today = londonDate(now);
  if (londonParts(now).hour < BRIEF_HOUR) return { skipped: "before 9am" };
  if (!(await claimToday(r, today))) return { skipped: "already done today" };

  // 1. Approved drafts held overnight (outside sending hours) go out now.
  const released = await processQueue(r, now);
  const ctx = await loadRestaurantContext();
  const weekday = londonWeekday(now);
  const silent = async () => {}; // drafts made here are held for the brief, not messaged

  // 2. Monday: this week's birthday email. Monday and Thursday: a Google post.
  let birthday = false;
  if (weekday === 1 && r.last_birthday_campaign_on !== today) {
    check(await getSupabase().from("restaurants").update({ last_birthday_campaign_on: today }).eq("id", r.id));
    await proposeBirthdayCampaign(ctx, silent, "hold");
    birthday = true;
  }
  let post = false;
  if ([1, 4].includes(weekday) && r.last_post_draft_on !== today) {
    check(await getSupabase().from("restaurants").update({ last_post_draft_on: today }).eq("id", r.id));
    await runPostJob(ctx);
    post = true;
  }

  // 3. Monday: last week's report.
  let reportHeadline: string | null = null;
  if (weekday === 1 && r.last_report_on !== today) {
    check(await getSupabase().from("restaurants").update({ last_report_on: today }).eq("id", r.id));
    reportHeadline = (await createReport(ctx, reportPeriod(now, true))).headline;
  }

  // 4. The brief itself.
  const channel = ownerChannel(r);
  if (!channel) return { released: released.length, birthday, post, report: Boolean(reportHeadline), brief: "no owner WhatsApp yet" };
  if (!(await canMessageFreely(r, now))) {
    await markBriefWaiting(r, now);
    return { released: released.length, birthday, post, report: Boolean(reportHeadline), brief: "waiting for the owner to message (24h rule)" };
  }
  const brief = await sendBrief(r, channel, now, { extra: released.length ? [queueResultsMessage(released)] : [] });
  if (reportHeadline) await messageOwner(channel, reportHeadline);
  return { released: released.length, birthday, post, report: Boolean(reportHeadline), brief };
}

// The owner just messaged and this morning's brief was waiting for them.
export async function deliverWaitingBrief(r: Restaurant, channel: OwnerChannel, now: Date) {
  if (!r.brief_waiting_since) return;
  // Only the Monday report the morning job made (it ends at midnight on the day
  // the brief was due), never one asked for with RUN REPORT.
  const due = new Date(r.brief_waiting_since);
  const report =
    r.last_report_on === londonDate(due)
      ? check(
          await getSupabase()
            .from("reports")
            .select("headline")
            .eq("restaurant_id", r.id)
            .eq("period_end", reportPeriod(due, true).end.toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ headline: string }>(),
        )
      : null;
  const note = "_This morning's brief, held until you messaged (WhatsApp only lets me message you within 24 hours of your last message)._";
  const outcome = await sendBrief(r, channel, now, { note });
  if (!outcome.sent) check(await getSupabase().from("restaurants").update({ brief_waiting_since: null }).eq("id", r.id));
  if (report) await messageOwner(channel, report.headline);
}
