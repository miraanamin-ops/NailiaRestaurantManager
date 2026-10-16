import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { getSupabase } from "@/lib/supabase";
import { allSwitches, describeSwitches, switchesRecord } from "@/lib/switches";
import { hourlyIsLate, runFailed, stuckRuns, unalertedFailures, type RunRow } from "./job-health";

// Every scheduled job run is recorded with its real outcome (job_runs), and the
// builder is alerted if one fails, gets stuck, or doesn't run on time.

export type Job = "hourly" | "daily";

// Each run records the switches it ran with (once per run), so /log shows them
// and any change between runs. Before supabase/025_job_switches.sql has been run
// there's no switches column: the run is recorded without them.
export async function startRun(job: Job) {
  const switches = allSwitches(process.env);
  console.log(`[${job} job] switches: ${describeSwitches(switches).map((s) => `${s.name}=${s.value}`).join(", ")}`);
  const supabase = getSupabase();
  let res = await supabase.from("job_runs").insert({ job, status: "running", switches: switchesRecord(switches) }).select("id").single<{ id: string }>();
  if (res.error) res = await supabase.from("job_runs").insert({ job, status: "running" }).select("id").single<{ id: string }>();
  if (res.error) console.error("Couldn't record the job start", res.error);
  return res.data?.id ?? null;
}

export type JobRunRow = { id: string; job: string; status: string; started_at: string; finished_at: string | null; error: string | null; switches?: Record<string, unknown> | null };

// The latest runs for /log (with their switches once the column exists).
export async function recentRuns(limit: number) {
  const supabase = getSupabase();
  const cols = "id, job, status, started_at, finished_at, error";
  const withSwitches = await supabase.from("job_runs").select(`${cols}, switches`).order("started_at", { ascending: false }).limit(limit).returns<JobRunRow[]>();
  if (!withSwitches.error) return withSwitches.data ?? [];
  const plain = await supabase.from("job_runs").select(cols).order("started_at", { ascending: false }).limit(limit).returns<JobRunRow[]>();
  return plain.data ?? [];
}

export async function finishRun(id: string | null, job: Job, summary: Record<string, unknown>[] | null, error: string | null) {
  const failed = Boolean(error) || (summary ? runFailed(summary) : false);
  if (id) {
    const { error: e } = await getSupabase()
      .from("job_runs")
      .update({ status: failed ? "failed" : "ok", finished_at: new Date().toISOString(), summary, error })
      .eq("id", id);
    if (e) console.error("Couldn't record the job outcome", e);
  }
  if (error || (summary && unalertedFailures(summary))) {
    const what = error ?? JSON.stringify(summary).slice(0, 600);
    await alertBuilder(`job-failed:${job}`, `The ${job} job failed.\n${what}`);
  }
  return failed;
}

// Checks the other jobs from inside a job run: stuck runs, and (from the daily
// backup) whether the hourly job has stopped running.
export async function checkJobHealth(current: Job, now: Date) {
  const supabase = getSupabase();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("job_runs")
    .select("id, job, status, started_at")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .returns<(RunRow & { id: string })[]>();
  if (error) {
    console.error("Couldn't read job runs", error);
    return;
  }
  const runs = data ?? [];

  for (const r of stuckRuns(runs, now)) {
    await supabase.from("job_runs").update({ status: "failed", finished_at: now.toISOString(), error: "Never finished (crashed or timed out)" }).eq("id", r.id);
    await alertBuilder(`job-stuck:${r.job}`, `A ${r.job} job run started at ${r.started_at} and never finished (it crashed or timed out).`);
  }

  if (current === "daily") {
    const lastHourly = runs.find((r) => r.job === "hourly")?.started_at ?? null;
    const trackingSince = runs.at(-1)?.started_at ?? null; // oldest run in the last 24 hours
    if (hourlyIsLate(lastHourly, now, trackingSince)) {
      await alertBuilder(
        "hourly-missing",
        `The hourly job hasn't run since ${lastHourly ?? "at least 24 hours ago"}. Check the Supabase schedule: select * from cron.job_run_details order by start_time desc limit 5;`,
      );
    }
  }
}
