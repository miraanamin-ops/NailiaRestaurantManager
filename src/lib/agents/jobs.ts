import "server-only";
import { logAction, type AgentActor, type AuditAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { PermanentJobError, type JobHandler as QueueHandler } from "@/lib/queue/registry";
import { keys } from "@/lib/queue/rules";
import { enqueue, type QueueJob } from "@/lib/queue/store";
// (Its own small check helper: lib/drafts.ts queues jobs, so this file mustn't import it.)
import { getSupabase } from "@/lib/supabase";
import { AgentOutputError } from "./run";
import { addUsage, totals, type Usage } from "./usage";

// Agent jobs: every piece of agent work has a unique key (job_key), so a
// repeat or retry never does the same work twice.
//
// Since the job queue (lib/queue), agent_jobs is the RECORD of each agent job
// (its input, output, verdict, version and cost; the audit log points at it,
// and live runs that happen straight away are recorded here too), while the
// queue's `jobs` table does the waiting, claiming, retrying and dead-lettering:
// queuing an agent job writes its record here and an `agent` job on the queue.
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

// Tries per agent job (the `agent` row in job_types says the same).
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
  const supabase = getSupabase();
  const { data, error } = await supabase
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
  if (!data) return null;
  try {
    await enqueue({
      type: "agent",
      restaurantId: input.restaurantId,
      key: keys.agent(input.key),
      payload: { agent_job_id: data.id, job_key: input.key, kind: input.kind },
      maxAttempts: MAX_ATTEMPTS,
    });
  } catch (err) {
    // Not on the queue: remove the record, so the same key can be queued again later.
    check(await supabase.from("agent_jobs").delete().eq("restaurant_id", input.restaurantId).eq("id", data.id));
    throw err;
  }
  return data;
}

async function finish(job: AgentJob, fields: Partial<AgentJob> & { finished_at?: string | null; started_at?: string | null }) {
  check(await getSupabase().from("agent_jobs").update(fields).eq("restaurant_id", job.restaurant_id).eq("id", job.id));
}

async function recordFor(qjob: QueueJob) {
  const id = String(qjob.payload?.agent_job_id ?? "");
  if (!id || !qjob.restaurant_id) return null;
  return check(
    await getSupabase().from("agent_jobs").select("*").eq("restaurant_id", qjob.restaurant_id).eq("id", id).maybeSingle<AgentJob>(),
  );
}

// The queue's handler for `agent` jobs: runs the agent job its record names.
export function agentQueueHandler(handlers: Record<string, JobHandler>): QueueHandler {
  return {
    run: async (qjob) => {
      const record = await recordFor(qjob);
      // The draft it was about was deleted (its record went with it), or a repeat.
      if (!record) return { skipped: "the agent job's record is gone" };
      if (record.status === "done") return { skipped: "already done" };
      const job: AgentJob = { ...record, status: "running", attempts: qjob.attempts };
      await finish(job, { status: "running", attempts: qjob.attempts, started_at: new Date().toISOString(), locked_until: qjob.locked_until });

      const handler = handlers[job.kind];
      try {
        if (!handler) throw new PermanentJobError(`No handler for agent job kind "${job.kind}"`);
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
        return { agent_job: job.job_key, verdict: out.verdict ?? null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Invalid output twice is final (the builder was already alerted). Anything
        // else (the API down, a timeout) is tried again by the queue.
        const final = err instanceof AgentOutputError || err instanceof PermanentJobError || qjob.attempts >= qjob.max_attempts;
        await finish(job, {
          status: final ? "failed" : "queued",
          error: message.slice(0, 1000),
          locked_until: null,
          finished_at: final ? new Date().toISOString() : null,
          // What the failed attempts used still counts.
          ...(err instanceof AgentOutputError ? usageFields(addUsage(job.usage ?? {}, err.usage)) : {}),
        });
        if (err instanceof AgentOutputError) throw new PermanentJobError(message, { cause: err });
        throw err;
      }
    },
    // Once, when the job has used its tries (or its worker crashed on the last one).
    alertOnDead: false,
    onDead: async (qjob, err) => {
      const record = await recordFor(qjob);
      if (!record) return;
      const message = err instanceof Error ? err.message : String(err);
      if (record.status !== "failed") await finish(record, { status: "failed", error: message.slice(0, 1000), locked_until: null, finished_at: new Date().toISOString() });
      // Invalid output twice: callAgent has already told the builder.
      const alreadyAlerted = err instanceof PermanentJobError && err.cause instanceof AgentOutputError;
      if (!alreadyAlerted) {
        await alertBuilder(`agent-job-failed:${record.agent}`, `The ${record.agent} agent job ${record.job_key} failed after ${qjob.attempts} tries.\n${message.slice(0, 400)}`);
      }
      await logAction({
        restaurantId: record.restaurant_id,
        draftId: record.draft_id,
        actor: "system",
        action: "agent_failed",
        detail: `The ${record.agent} agent couldn't finish its job (the builder has been told)`,
        data: { job_key: record.job_key, error: message.slice(0, 300) },
        job: { jobId: record.id, agent: record.agent, agentVersion: null, verdict: null },
      });
    },
  };
}

// Runs this restaurant's queued agent jobs now, oldest first, one at a time (the
// Monday post step needs Visibility's post before the brief; tests). Never
// throws: a failing job is recorded, retried later by the queue or, after its
// last try, the builder alerted; the next job still runs.
// Statuses: done, retry (it failed and waits for its next try), failed (dead).
export async function runAgentJobs(restaurantId: string, handlers: Record<string, JobHandler>, opts: { limit?: number; now?: Date } = {}) {
  const { runWorker } = await import("@/lib/queue/worker");
  try {
    const results = await runWorker({
      types: ["agent"],
      restaurantId,
      limit: opts.limit ?? 10,
      lanes: 1,
      now: () => opts.now,
      handlers: { agent: agentQueueHandler(handlers) },
    });
    return results
      .filter((r) => r.status !== "lost")
      .map((r) => ({ key: r.key.replace(/^agent:/, ""), status: r.status === "dead" ? "failed" : r.status }));
  } catch (err) {
    console.error("Agent jobs couldn't run", err);
    await alertBuilder(`agent-jobs:${restaurantId}`, `Agent jobs for restaurant ${restaurantId} couldn't run: ${err instanceof Error ? err.message : String(err)}`);
    return [];
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
