import { after, type NextRequest } from "next/server";
import { runWorker } from "@/lib/queue/worker";

// Each call is one worker with its own time budget: it stops taking new jobs
// after WORKER.claimForMs (lib/queue/config.ts) so the jobs it started can finish.
export const maxDuration = 300;

// A worker for the job queue (lib/queue). Needs the CRON_SECRET password.
// Started by Supabase every minute when jobs are due (supabase/028_queue_schedule.sql),
// by the hourly job straight after it queues its work, and by the WhatsApp webhook
// for an owner's message. It answers at once and works in the background, so
// whoever started it never waits.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  after(async () => {
    const results = await runWorker();
    if (results.length) console.log("Worker", JSON.stringify(results.map((r) => ({ key: r.key, status: r.status }))));
  });
  return Response.json({ started: true });
}

export const GET = handle;
export const POST = handle;
