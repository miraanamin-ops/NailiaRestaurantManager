import { after, type NextRequest } from "next/server";
import { loadRestaurantContext } from "@/lib/assistant";
import { proposeBirthdayCampaign } from "@/lib/bot";
import { londonDate } from "@/lib/campaigns";
import { londonParts } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel, releaseQueue, sendReminders, weeklySummary } from "@/lib/followups";
import { presentNext, runPostJob, runReviewCheck } from "@/lib/google-jobs";
import { messageOwner } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";

function londonWeekday(now: Date) {
  const p = londonParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
}

// Every Monday the daily job drafts that week's birthday email for approval.
// (Folded into the daily job so it doesn't need another scheduled job.)
async function mondayBirthdayEmail(r: Restaurant, now: Date) {
  const today = londonDate(now);
  const channel = ownerChannel(r);
  if (londonWeekday(now) !== 1 || !channel || r.last_birthday_campaign_on === today) return false;
  await getSupabase().from("restaurants").update({ last_birthday_campaign_on: today }).eq("id", r.id);
  const ctx = await loadRestaurantContext();
  await proposeBirthdayCampaign(ctx, (text, withButtons) => messageOwner(channel, text, withButtons), "queue");
  return true;
}

// Mondays and Thursdays: draft one Google post each (two a week) into the queue.
async function twiceWeeklyPost(r: Restaurant, now: Date) {
  const today = londonDate(now);
  const channel = ownerChannel(r);
  if (![1, 4].includes(londonWeekday(now)) || !channel || r.last_post_draft_on === today) return false;
  await getSupabase().from("restaurants").update({ last_post_draft_on: today }).eq("id", r.id);
  await runPostJob(await loadRestaurantContext(), (text, withButtons) => messageOwner(channel, text, withButtons));
  return true;
}

// Scheduled jobs. All need the CRON_SECRET password.
//   ?job=hourly  (Supabase pg_cron, every hour): check for new Google reviews
//   ?job=daily   (Vercel cron, each morning): release queued sends, reminders,
//                Monday birthday email, Monday/Thursday Google post
//   ?job=weekly  (Vercel cron, Sunday evening): the weekly round-up
// Scheduled jobs always use the real time, never the TIME test clock.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const job = req.nextUrl.searchParams.get("job");
  if (job !== "hourly" && job !== "daily" && job !== "weekly") return new Response("Unknown job", { status: 400 });

  // Supabase's scheduler only waits a few seconds for an answer, and drafting
  // replies takes longer, so the hourly job answers at once and works in the background.
  if (job === "hourly") {
    after(() => runJob(job).catch((err) => console.error("Hourly job failed", err)));
    return Response.json({ job, started: true });
  }
  return Response.json({ job, summary: await runJob(job) });
}

async function runJob(job: "hourly" | "daily" | "weekly") {
  const restaurants = check(await getSupabase().from("restaurants").select("*").returns<Restaurant[]>()) ?? [];
  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  for (const r of restaurants) {
    const channel = ownerChannel(r);
    if (job === "hourly") {
      if (!channel) {
        summary.push({ restaurant: r.id, skipped: "no owner WhatsApp yet" });
        continue;
      }
      const ctx = await loadRestaurantContext();
      const send = (text: string, withButtons?: boolean) => messageOwner(channel, text, withButtons);
      const reviews = await runReviewCheck(ctx, send);
      const presented = await presentNext(ctx, send);
      summary.push({ restaurant: r.id, ...reviews, presentedFromQueue: presented });
    } else if (job === "daily") {
      const released = await releaseQueue(r, now);
      const reminders = await sendReminders(r, now);
      const birthday = await mondayBirthdayEmail(r, now);
      const post = await twiceWeeklyPost(r, now);
      summary.push({ restaurant: r.id, released: released.length, reminders, birthday, post });
    } else {
      if (channel) await messageOwner(channel, await weeklySummary(r, now));
      summary.push({ restaurant: r.id, weekly: Boolean(channel) });
    }
  }
  return summary;
}
