import { after, type NextRequest } from "next/server";
import { loadRestaurantContext } from "@/lib/assistant";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { runReviewCheck } from "@/lib/google-jobs";
import { runMorning } from "@/lib/morning";
import { messageOwner } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The morning job writes drafts and the weekly report with Claude, which takes a while.
export const maxDuration = 300;

// Scheduled jobs. All need the CRON_SECRET password.
//   ?job=hourly  (Supabase pg_cron, 5 past every hour): check for new Google reviews;
//                from 9am UK time, also the morning job (once a day)
//   ?job=daily   (Vercel cron, 09:00 UTC = 9am or 10am UK): a backup for the
//                morning job, in case the hourly one didn't run
// The morning job: release held sends, Monday birthday email, Monday/Thursday
// Google post, Monday report, then the morning brief. See lib/morning.ts.
// Scheduled jobs always use the real time, never the TIME test clock.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const job = req.nextUrl.searchParams.get("job");
  if (job !== "hourly" && job !== "daily") return new Response("Unknown job", { status: 400 });

  // Supabase's scheduler only waits a few seconds for an answer, and drafting
  // replies takes longer, so the hourly job answers at once and works in the background.
  if (job === "hourly") {
    after(() => runJob(job).catch((err) => console.error("Hourly job failed", err)));
    return Response.json({ job, started: true });
  }
  return Response.json({ job, summary: await runJob(job) });
}

async function runJob(job: "hourly" | "daily") {
  const restaurants = check(await getSupabase().from("restaurants").select("*").returns<Restaurant[]>()) ?? [];
  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  for (const r of restaurants) {
    const channel = ownerChannel(r);
    const entry: Record<string, unknown> = { restaurant: r.id };
    if (job === "hourly") {
      if (channel) {
        const ctx = await loadRestaurantContext();
        // Only 1-3 star alerts are messaged now; 4-5 star replies wait for the brief.
        entry.reviews = await runReviewCheck(ctx, (text, withButtons) => messageOwner(channel, text, withButtons));
      } else {
        entry.reviews = "skipped: no owner WhatsApp yet";
      }
    }
    try {
      entry.morning = await runMorning(r, now);
    } catch (err) {
      console.error("Morning job failed", err);
      entry.morning = { error: err instanceof Error ? err.message : String(err) };
    }
    summary.push(entry);
  }
  console.log(`Cron ${job}`, JSON.stringify(summary));
  return summary;
}
