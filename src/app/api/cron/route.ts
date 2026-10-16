import type { NextRequest } from "next/server";
import { checkJobHealth, finishRun, startRun, type Job } from "@/lib/job-runs";
import { clearOldRateLimits } from "@/lib/rate-limit";
import { dispatch } from "@/lib/queue/dispatch";
import { checkLateBriefs, checkQueueHealth } from "@/lib/queue/health";

// Only queues work now (seconds), but give it room on a slow day.
export const maxDuration = 60;

// Scheduled jobs. All need the CRON_SECRET password.
//   ?job=hourly  (Supabase pg_cron, 5 past every hour): queues, for every active
//                restaurant, the review check, held GM alerts, "How was your
//                visit?" emails, sends that are due and the day's weather; from
//                9am UK time the morning job's first step (once a day); and the
//                9:31 brief check and the daily clean-up. Then it starts workers.
//   ?job=daily   (Vercel cron, 09:00 UTC = 9am or 10am UK): a backup that queues
//                the morning job, and checks the hourly job is still running.
// The work itself runs on the job queue (lib/queue, /api/jobs/work), one job per
// restaurant per task, so one slow or failing restaurant never delays another.
// Every run is recorded in job_runs with its real outcome; failures, stuck runs,
// a backed-up queue and late briefs alert the builder (never a restaurant owner).
// Scheduled jobs always use the real time, never the TIME test clock.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const job = req.nextUrl.searchParams.get("job");
  if (job !== "hourly" && job !== "daily") return new Response("Unknown job", { status: 400 });
  return Response.json({ job, ...(await recordedRun(job)) });
}

async function recordedRun(job: Job) {
  const id = await startRun(job);
  try {
    const now = new Date();
    await checkJobHealth(job, now);
    const summary = await dispatch(job, now);
    if (job === "hourly") await clearOldRateLimits(now);
    // The queue's own health, and (after 9:30) any brief that still hasn't gone.
    // Never stops the run.
    try {
      await checkQueueHealth(now);
      await checkLateBriefs(now);
    } catch (err) {
      console.error("Queue health check failed", err);
    }
    console.log(`Cron ${job}`, JSON.stringify(summary));
    const failed = await finishRun(id, job, summary, null);
    return { ok: !failed, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`The ${job} job crashed`, err);
    await finishRun(id, job, null, message);
    return { ok: false, error: message };
  }
}
