import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { proposeBirthdayCampaign } from "@/lib/bot/flows";
import { canMessageFreely, markBriefWaiting, sendBrief } from "@/lib/brief";
import { londonWeekday, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { queueResultsMessage } from "@/lib/format";
import { ownerChannel } from "@/lib/followups";
import { runPostJob } from "@/lib/google-jobs";
import { gmMode } from "@/lib/agents/gm";
import { gmBrief, gmReportMessage } from "@/lib/agents/gm-brief";
import { liveGrowthBirthdays, mondayGrowth } from "@/lib/agents/growth";
import { mondayVisibility } from "@/lib/agents/visibility";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import type { MorningStep } from "@/lib/queue/rules";
import { createReport, reportPeriod } from "@/lib/report/build";
import { processQueue } from "@/lib/send";
import type { ReportData } from "@/lib/report/types";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";

// The morning job: everything that happens once a day at 9am UK time, ending
// in one brief to the owner (plus the report link on Mondays).
//
// Each step is its own job on the queue (lib/queue/handlers.ts), run in the
// order of MORNING_STEPS in lib/queue/rules.ts: the next step is queued only
// once this one has worked, so the brief always comes last. A failed step is
// retried on its own (1, 5, 15, 60 minutes); the BUILDER is told on the first
// failure and if it dies (never the restaurant owner). Each step is also marked
// done on the restaurant (last_post_draft_on etc.), so repeating one never
// repeats its work.
// Kept for morningGate (lib/morning-gate.ts): the queue's retries replace the old
// hourly ones, so morning_failures is no longer counted up.
export const MAX_FAILURES = 3;

// What one step hands to the next: the line about sends released this morning,
// which goes in the brief.
export type MorningCarry = { released?: string | null };

async function setFields(r: Restaurant, fields: Partial<Restaurant>) {
  check(await getSupabase().from("restaurants").update(fields).eq("id", r.id));
}

// This Monday's report, if the morning job has made it (it covers last Monday to Sunday,
// so a report asked for with RUN REPORT never matches). With the GM live, the composer
// writes the 2 lines (today's headline if it can't).
async function mondayReportHeadline(r: Restaurant, due: Date) {
  if (r.last_report_on !== londonYmd(due)) return null;
  const row = check(
    await getSupabase()
      .from("reports")
      .select("headline, token, data")
      .eq("restaurant_id", r.id)
      .eq("period_end", reportPeriod(due, true).end.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ headline: string; token: string; data: ReportData }>(),
  );
  if (!row) return null;
  if ((await gmMode(r)) === "live") return (await gmReportMessage(r, { url: `${appUrl()}/report/${row.token}`, data: row.data })) ?? row.headline;
  return row.headline;
}

// The brief: the GM's when it's live (see gmMode), today's otherwise.
async function briefFor(r: Restaurant, channel: OwnerChannel, now: Date, opts: { extra?: string[]; note?: string }) {
  return (await gmMode(r)) === "live" ? gmBrief(r, channel, now, opts) : sendBrief(r, channel, now, opts);
}

// One step of the morning job. Throws if it fails (the queue retries it).
export async function runMorningStep(
  restaurant: Restaurant,
  step: MorningStep,
  now: Date,
  carry: MorningCarry = {},
): Promise<{ done: string; carry: MorningCarry; brief?: unknown }> {
  const today = londonYmd(now);
  const weekday = londonWeekday(now);
  const silent = async () => {}; // drafts made here are held for the brief, not messaged
  const r = restaurant;

  switch (step) {
    // 1. Approved drafts held overnight (outside sending hours) go out now.
    //    Safe to repeat: anything already sent is never sent twice.
    case "release": {
      const released = await processQueue(r, now);
      return { done: `released ${released.length}`, carry: { released: released.length ? queueResultsMessage(released) : null } };
    }

    // 2. Monday: this week's birthday email.
    case "birthday": {
      if (weekday !== 1 || r.last_birthday_campaign_on === today) return { done: "birthday email: nothing to do", carry };
      const ctx = await loadRestaurantContext(r.id, { realTime: true });
      // Growth live writes the birthday batch instead; otherwise today's email (Growth in shadow beside it).
      if (!(await liveGrowthBirthdays(ctx.restaurant, today))) await proposeBirthdayCampaign(ctx, silent, "hold");
      await setFields(r, { last_birthday_campaign_on: today });
      return { done: "birthday email", carry };
    }

    // 3. Monday and Thursday: a Google post.
    case "post": {
      if (![1, 4].includes(weekday) || r.last_post_draft_on === today) return { done: "Google post: nothing to do", carry };
      await runPostJob(await loadRestaurantContext(r.id, { realTime: true }));
      await setFields(r, { last_post_draft_on: today });
      return { done: "Google post", carry };
    }

    // 4. Monday: last week's report.
    case "report": {
      if (weekday !== 1 || r.last_report_on === today) return { done: "report: nothing to do", carry };
      await createReport(await loadRestaurantContext(r.id, { realTime: true }), reportPeriod(now, true));
      await setFields(r, { last_report_on: today });
      return { done: "report", carry };
    }

    // 5. Monday: Visibility looks 4 weeks ahead for bank holidays with no special
    //    hours set (questions held for this brief), and queues the content brief;
    //    Growth: this week's plan, calendar dates 2 to 3 weeks ahead, special ideas.
    case "monday": {
      if (weekday !== 1) return { done: "monday: nothing to do", carry };
      const done: string[] = [];
      const asked = await mondayVisibility(r, today);
      if (asked.length) done.push(`hours questions: ${asked.join(", ")}`);
      const growth = await mondayGrowth(r, today);
      if (growth.length) done.push(`growth: ${growth.join(", ")}`);
      return { done: done.join("; ") || "monday: nothing new", carry };
    }

    // 6. The brief itself. A brief held for WhatsApp's 24-hour rule counts as done:
    //    it goes with the owner's next message.
    case "brief": {
      const fresh = (await loadRestaurantContext(r.id, { realTime: true })).restaurant;
      if (fresh.last_brief_on === today) return { done: "brief: already sent today", carry };
      const channel = ownerChannel(fresh);
      let brief: unknown = "no owner WhatsApp yet";
      if (channel && !(await canMessageFreely(fresh, now))) {
        await markBriefWaiting(fresh, now);
        brief = "waiting for the owner to message (24h rule)";
      } else if (channel) {
        brief = await briefFor(fresh, channel, now, { extra: carry.released ? [carry.released] : [] });
        const headline = await mondayReportHeadline(fresh, now);
        if (headline) await messageOwner(channel, headline);
      }
      await setFields(fresh, { last_brief_on: today, morning_failures: 0, morning_failed_on: null, morning_lock_until: null });
      return { done: "brief", carry, brief };
    }
  }
}

// The owner just messaged and this morning's brief was waiting for them.
export async function deliverWaitingBrief(r: Restaurant, channel: OwnerChannel, now: Date) {
  if (!r.brief_waiting_since) return;
  const note = "_This morning's brief, held until you messaged (WhatsApp only lets me message you within 24 hours of your last message)._";
  const outcome = await briefFor(r, channel, now, { note });
  if (!outcome.sent) check(await getSupabase().from("restaurants").update({ brief_waiting_since: null }).eq("id", r.id));
  const headline = await mondayReportHeadline(r, new Date(r.brief_waiting_since));
  if (headline) await messageOwner(channel, headline);
}
