import type { NextRequest } from "next/server";
import { loadRestaurantContext } from "@/lib/assistant";
import { proposeBirthdayCampaign } from "@/lib/bot";
import { londonDate } from "@/lib/campaigns";
import { londonParts } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel, releaseQueue, sendReminders, weeklySummary } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Every Monday the daily job drafts that week's birthday email for approval.
// (Folded into the daily job so it doesn't need another scheduled job.)
async function mondayBirthdayEmail(r: Restaurant, now: Date) {
  const today = londonDate(now);
  const p = londonParts(now);
  const isMonday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 1;
  const channel = ownerChannel(r);
  if (!isMonday || !channel || r.last_birthday_campaign_on === today) return false;
  await getSupabase().from("restaurants").update({ last_birthday_campaign_on: today }).eq("id", r.id);
  const ctx = await loadRestaurantContext();
  await proposeBirthdayCampaign(ctx, (text, withButtons) => messageOwner(channel, text, withButtons));
  return true;
}

// Vercel calls this on the schedule in vercel.json:
//   ?job=daily  each morning: release queued drafts and send reminders
//   ?job=weekly Sunday evening: the weekly round-up
// Scheduled jobs always use the real time, never the TIME test clock.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const job = req.nextUrl.searchParams.get("job");
  if (job !== "daily" && job !== "weekly") return new Response("Unknown job", { status: 400 });

  const restaurants = check(await getSupabase().from("restaurants").select("*").returns<Restaurant[]>()) ?? [];
  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  for (const r of restaurants) {
    if (job === "daily") {
      const released = await releaseQueue(r, now);
      const reminders = await sendReminders(r, now);
      const birthday = await mondayBirthdayEmail(r, now);
      summary.push({ restaurant: r.id, released: released.length, reminders, birthday });
    } else {
      const channel = ownerChannel(r);
      if (channel) await messageOwner(channel, await weeklySummary(r, now));
      summary.push({ restaurant: r.id, weekly: Boolean(channel) });
    }
  }
  return Response.json({ job, summary });
}
