import { after, type NextRequest } from "next/server";
import { loadRestaurantContext } from "@/lib/assistant";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonParts, londonYmd } from "@/lib/clock";
import { check, checkRow } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { runReviewCheck } from "@/lib/google-jobs";
import { briefIsLate } from "@/lib/job-health";
import { checkJobHealth, finishRun, startRun, type Job } from "@/lib/job-runs";
import { MAX_FAILURES, runMorning } from "@/lib/morning";
import { messageOwner } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The morning job writes drafts and the weekly report with Claude, which takes a while.
export const maxDuration = 300;

// Scheduled jobs. All need the CRON_SECRET password.
//   ?job=hourly  (Supabase pg_cron, 5 past every hour): check for new Google reviews;
//                from 9am UK time, also the morning job (once a day)
//   ?job=daily   (Vercel cron, 09:00 UTC = 9am or 10am UK): a backup for the
//                morning job, and a check that the hourly job is still running
// The morning job: release held sends, Monday birthday email, Monday/Thursday
// Google post, Monday report, then the morning brief. See lib/morning.ts.
// Every run is recorded in job_runs with its real outcome; failures, stuck runs
// and late jobs alert the builder (never a restaurant owner). Scheduled jobs
// always use the real time, never the TIME test clock.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const job = req.nextUrl.searchParams.get("job");
  if (job !== "hourly" && job !== "daily") return new Response("Unknown job", { status: 400 });

  // Supabase's scheduler only waits a few seconds for an answer, and drafting
  // replies takes longer, so the hourly job answers at once and works in the background.
  // Its real outcome is still recorded when it finishes.
  if (job === "hourly") {
    after(() => recordedRun(job));
    return Response.json({ job, started: true });
  }
  return Response.json({ job, ...(await recordedRun(job)) });
}

async function recordedRun(job: Job) {
  const id = await startRun(job);
  try {
    await checkJobHealth(job, new Date());
    const summary = await runJob(job);
    const failed = await finishRun(id, job, summary, null);
    return { ok: !failed, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`The ${job} job crashed`, err);
    await finishRun(id, job, null, message);
    return { ok: false, error: message };
  }
}

async function runJob(job: Job) {
  const restaurants = check(await getSupabase().from("restaurants").select("*").returns<Restaurant[]>()) ?? [];
  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  for (const r of restaurants) {
    const channel = ownerChannel(r);
    const entry: Record<string, unknown> = { restaurant: r.id };
    if (job === "hourly") {
      try {
        if (channel) {
          const ctx = await loadRestaurantContext({ realTime: true });
          // Only 1-3 star alerts are messaged now; 4-5 star replies wait for the brief.
          entry.reviews = await runReviewCheck(ctx, (text, withButtons) => messageOwner(channel, text, withButtons));
        } else {
          entry.reviews = { skipped: "no owner WhatsApp yet" };
        }
      } catch (err) {
        console.error("Review check failed", err);
        entry.reviews = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    try {
      entry.morning = await runMorning(r, now);
    } catch (err) {
      console.error("Morning job failed", err);
      entry.morning = { error: err instanceof Error ? err.message : String(err) };
    }

    // The brief should be out by 11am. If it isn't (and the job hasn't already
    // reported giving up), tell the builder.
    const fresh = checkRow(await getSupabase().from("restaurants").select("*").eq("id", r.id).single<Restaurant>());
    const today = londonYmd(now);
    if (
      briefIsLate({
        londonHour: londonParts(now).hour,
        today,
        lastBriefOn: fresh.last_brief_on,
        failuresToday: fresh.morning_failed_on === today ? fresh.morning_failures : 0,
        maxFailures: MAX_FAILURES,
      })
    ) {
      await alertBuilder(`brief-late:${r.id}:${today}`, `${r.name}'s morning brief still hasn't gone out (it's after 11am).`);
    }
    summary.push(entry);
  }
  console.log(`Cron ${job}`, JSON.stringify(summary));
  return summary;
}
