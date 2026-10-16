import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonMinutes, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { backlogProblem, briefIsLate } from "@/lib/job-health";
import { getSupabase } from "@/lib/supabase";
import { deadJobs, queueStats, requeueExpired } from "./store";
import { handleExpired, jobDied } from "./worker";

// Health checks for the builder (never the owner): run by the 9:31 health job
// and by every hourly run.

// Every active restaurant's brief should be out by 9:30 UK. A brief held for
// WhatsApp's 24-hour rule counts as ready (it goes with the owner's next message).
export async function checkLateBriefs(now: Date) {
  const today = londonYmd(now);
  const restaurants =
    check(
      await getSupabase().from("restaurants").select("id, name, last_brief_on").eq("active", true).returns<{ id: string; name: string; last_brief_on: string | null }[]>(),
    ) ?? [];
  const late = restaurants.filter((r) => briefIsLate({ londonMinutes: londonMinutes(now), today, lastBriefOn: r.last_brief_on }));
  for (const r of late) {
    await alertBuilder(
      `brief-late:${r.id}:${today}`,
      `${r.name}'s morning brief hasn't gone out (it was due by 9:30). See the morning jobs on /log. The owner hasn't been told.`,
    );
  }
  return late.map((r) => r.id);
}

// The queue itself: too much waiting, stuck jobs, and dead jobs nobody has
// been told about (e.g. from the Python service, which can't alert).
export async function checkQueueHealth(now: Date) {
  const { HANDLERS } = await import("./handlers");
  const stats = await queueStats(now);
  const backlog = backlogProblem(stats, now);
  if (backlog) await alertBuilder("queue-backlog", `The job queue is backing up: ${backlog}. Check /log, and whether workers are starting (Supabase: select * from cron.job_run_details order by start_time desc limit 5;).`);

  const expired = await requeueExpired(now);
  await handleExpired(expired, HANDLERS, now);

  const unalerted = (await deadJobs(100)).filter((j) => !j.alerted_at);
  for (const job of unalerted) await jobDied(job, new Error(job.last_error ?? "Died"), HANDLERS, now);

  return { backlog, stuck: expired.length, deadAlerted: unalerted.length };
}
