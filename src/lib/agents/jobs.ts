import "server-only";
import { logAction, type AgentActor, type AuditAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
// (Its own small check helper: lib/drafts.ts queues jobs, so this file mustn't import it.)
import { getSupabase } from "@/lib/supabase";
import { AgentOutputError } from "./run";
import { addUsage, totals, type Usage } from "./usage";

// Agent jobs: every piece of agent work has a unique key (job_key), so a
// repeat or retry never does the same work twice. Jobs are queued when
// something happens (e.g. a draft is created) and run straight after the
// owner's reply has gone, or by the hourly job if that didn't finish.
// Every finished job is written to the audit log with its id, agent, version
// and verdict. A job that keeps failing alerts the builder, never the owner.

export type AgentJob = {
  id: string;
  restaurant_id: string;
  job_key: string;
  agent: string;
  kind: string;
  trigger: string;
  draft_id: string | null;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  locked_until: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  agent_version: string | null;
  verdict: string | null;
  error: string | null;
  created_at: string;
  usage?: Usage | null;
  cost_usd?: number | null;
};

// The job's tokens per agent and its estimated cost (only written when known, so
// older jobs and tests without them are unchanged).
function usageFields(usage: Usage | undefined) {
  return usage && Object.keys(usage).length ? { usage, cost_usd: Number(totals(usage).cost.toFixed(6)) } : {};
}

// What a job's handler reports back.
export type JobOutcome = {
  output: Record<string, unknown>;
  agentVersion: string;
  verdict?: string | null;
  // One line for the audit log.
  detail: string;
  actor: AgentActor;
  // The audit log action (default: checked).
  action?: AuditAction;
  // Tokens and estimated cost, per agent.
  usage?: Usage;
};
export type JobHandler = (job: AgentJob) => Promise<JobOutcome>;

const LOCK_MINUTES = 5;
export const MAX_ATTEMPTS = 3;

// Adds a job unless one with the same key already exists. Returns the new job, or null if it was already there.
export async function enqueueAgentJob(input: {
  restaurantId: string;
  key: string;
  agent: string;
  kind: string;
  trigger: string;
  draftId?: string | null;
  input?: Record<string, unknown>;
}) {
  const { data, error } = await getSupabase()
    .from("agent_jobs")
    .insert({
      restaurant_id: input.restaurantId,
      job_key: input.key,
      agent: input.agent,
      kind: input.kind,
      trigger: input.trigger,
      draft_id: input.draftId ?? null,
      input: input.input ?? null,
      status: "queued",
      attempts: 0,
    })
    .select("*")
    .maybeSingle<AgentJob>();
  // 23505 = the unique key: this exact job was queued before.
  if (error?.code === "23505") return null;
  if (error) throw new Error(error.message);
  return data;
}

// Takes one queued job for this restaurant, so no other run picks it up too.
async function claim(job: AgentJob) {
  const now = new Date();
  return check(
    await getSupabase()
      .from("agent_jobs")
      .update({
        status: "running",
        attempts: job.attempts + 1,
        started_at: now.toISOString(),
        locked_until: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(),
      })
      .eq("restaurant_id", job.restaurant_id)
      .eq("id", job.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle<AgentJob>(),
  );
}

async function finish(job: AgentJob, fields: Partial<AgentJob> & { finished_at?: string | null }) {
  check(await getSupabase().from("agent_jobs").update(fields).eq("restaurant_id", job.restaurant_id).eq("id", job.id));
}

// Runs this restaurant's queued jobs, oldest first. Never throws: a failing
// job is recorded and the builder alerted, and the next job still runs.
export async function runAgentJobs(restaurantId: string, handlers: Record<string, JobHandler>, opts: { limit?: number } = {}) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const results: { key: string; status: string }[] = [];
  try {
    // A job whose run crashed or timed out goes back in the queue.
    check(
      await supabase
        .from("agent_jobs")
        .update({ status: "queued", locked_until: null })
        .eq("restaurant_id", restaurantId)
        .eq("status", "running")
        .lt("locked_until", now),
    );
    const queued =
      check(
        await supabase
          .from("agent_jobs")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("status", "queued")
          .order("created_at")
          .limit(opts.limit ?? 10)
          .returns<AgentJob[]>(),
      ) ?? [];

    for (const q of queued) {
      const job = await claim(q);
      if (!job) continue; // another run took it
      results.push({ key: job.job_key, status: await runOne(job, handlers) });
    }
  } catch (err) {
    console.error("Agent jobs couldn't run", err);
    await alertBuilder(`agent-jobs:${restaurantId}`, `Agent jobs for restaurant ${restaurantId} couldn't run: ${err instanceof Error ? err.message : String(err)}`);
  }
  return results;
}

async function runOne(job: AgentJob, handlers: Record<string, JobHandler>) {
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`No handler for agent job kind "${job.kind}"`);
    const out = await handler(job);
    await finish(job, {
      status: "done",
      ...usageFields(out.usage),
      output: out.output,
      agent_version: out.agentVersion,
      verdict: out.verdict ?? null,
      error: null,
      locked_until: null,
      finished_at: new Date().toISOString(),
    });
    await logAction({
      restaurantId: job.restaurant_id,
      draftId: job.draft_id,
      actor: out.actor,
      action: out.action ?? "checked",
      detail: out.detail,
      data: { job_key: job.job_key, kind: job.kind },
      job: { jobId: job.id, agent: job.agent, agentVersion: out.agentVersion, verdict: out.verdict ?? null },
    });
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Agent job ${job.job_key} failed`, err);
    // Invalid output twice is final (the builder was already alerted). Anything
    // else (the API down, a timeout) is tried again, up to MAX_ATTEMPTS.
    const final = err instanceof AgentOutputError || job.attempts >= MAX_ATTEMPTS;
    await finish(job, {
      status: final ? "failed" : "queued",
      error: message.slice(0, 1000),
      locked_until: null,
      finished_at: final ? new Date().toISOString() : null,
      // What the failed attempts used still counts.
      ...(err instanceof AgentOutputError ? usageFields(addUsage(job.usage ?? {}, err.usage)) : {}),
    });
    if (final) {
      if (!(err instanceof AgentOutputError)) {
        await alertBuilder(`agent-job-failed:${job.agent}`, `The ${job.agent} agent job ${job.job_key} failed after ${job.attempts} tries.\n${message.slice(0, 400)}`);
      }
      await logAction({
        restaurantId: job.restaurant_id,
        draftId: job.draft_id,
        actor: "system",
        action: "agent_failed",
        detail: `The ${job.agent} agent couldn't finish its job (the builder has been told)`,
        data: { job_key: job.job_key, error: message.slice(0, 300) },
        job: { jobId: job.id, agent: job.agent, agentVersion: null, verdict: null },
      });
    }
    return final ? "failed" : "retry";
  }
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// A live agent run that happened straight away (not from the queue), recorded as
// a finished job so the log can name its job id. A repeat of the same key is ignored.
export async function recordAgentRun(input: {
  restaurantId: string;
  key: string;
  agent: string;
  kind: string;
  trigger: string;
  draftId?: string | null;
  output: Record<string, unknown>;
  agentVersion: string;
  verdict: string | null;
  usage?: Usage;
}) {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("agent_jobs")
    .insert({
      restaurant_id: input.restaurantId,
      job_key: input.key,
      agent: input.agent,
      kind: input.kind,
      trigger: input.trigger,
      draft_id: input.draftId ?? null,
      status: "done",
      attempts: 1,
      output: input.output,
      agent_version: input.agentVersion,
      verdict: input.verdict,
      started_at: now,
      finished_at: now,
      ...usageFields(input.usage),
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error && error.code !== "23505") console.error("Couldn't record the agent run", error);
  return data?.id ?? null;
}
