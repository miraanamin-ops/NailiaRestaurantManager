import "server-only";
import { randomUUID } from "node:crypto";
import { alertBuilder } from "@/lib/builder-alerts";
import { getSupabase } from "@/lib/supabase";
import { WORKER } from "./config";
import { PermanentJobError, type JobHandler } from "./registry";
import { claim, complete, fail, markAlerted, requeueExpired, type QueueJob } from "./store";

// A worker: takes due jobs from the queue and runs them, a few side by side
// (lanes), until there are none left or its time is up. Started every minute by
// Supabase (when jobs are due), straight after the hourly job queues its work,
// and by the WhatsApp webhook. Many workers can run at once: the database hands
// each job to one of them only.
//
// One job failing never stops the others: each runs in its own try/catch.
// The builder is told when a job dies; a restaurant owner never is (an owner
// whose own message failed gets the usual "Sorry, something went wrong").

export type WorkerResult = { id: string; type: string; key: string; restaurantId: string | null; status: "done" | "retry" | "dead" | "lost"; error?: string };

export type WorkerOptions = {
  worker?: string;
  lanes?: number;
  claimForMs?: number;
  // Only these job types / this restaurant's jobs (e.g. RUN commands, tests).
  types?: string[];
  restaurantId?: string;
  // At most this many jobs in this call.
  limit?: number;
  // The time the queue uses (tests and the simulation); default the database's clock.
  now?: () => Date | undefined;
  handlers?: Record<string, JobHandler>;
};

async function defaultHandlers() {
  return (await import("./handlers")).HANDLERS;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runWorker(opts: WorkerOptions = {}): Promise<WorkerResult[]> {
  const worker = opts.worker ?? `app-${randomUUID().slice(0, 8)}`;
  const handlers = opts.handlers ?? (await defaultHandlers());
  const now = opts.now ?? (() => undefined);
  const started = Date.now();
  const claimFor = opts.claimForMs ?? WORKER.claimForMs;
  const results: WorkerResult[] = [];
  let claims = 0;

  // Jobs whose worker crashed go back in the queue (or die, on their last try).
  try {
    await handleExpired(await requeueExpired(now()), handlers, now());
  } catch (err) {
    console.error("Couldn't requeue expired jobs", err);
  }

  const lane = async () => {
    while (Date.now() - started < claimFor && (opts.limit === undefined || claims < opts.limit)) {
      claims++;
      let job: QueueJob | undefined;
      try {
        [job] = await claim({ worker, types: opts.types, restaurantId: opts.restaurantId, now: now() });
      } catch (err) {
        console.error("Couldn't claim a job", err);
        await alertBuilder("queue-claim", `Workers can't take jobs from the queue: ${errorText(err)}`);
        return;
      }
      if (!job) return;
      results.push(await runJob(job, worker, handlers, now));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.lanes ?? WORKER.lanes) }, lane));
  return results;
}

async function runJob(job: QueueJob, worker: string, handlers: Record<string, JobHandler>, now: () => Date | undefined): Promise<WorkerResult> {
  const base = { id: job.id, type: job.type, key: job.idempotency_key, restaurantId: job.restaurant_id };
  const handler = handlers[job.type];
  try {
    if (!handler) throw new PermanentJobError(`No handler for job type "${job.type}"`);
    const result = await handler.run(job);
    await complete(job.id, worker, (result as Record<string, unknown>) ?? null, now());
    return { ...base, status: "done" };
  } catch (err) {
    const message = errorText(err);
    console.error(`Job ${job.idempotency_key} failed (try ${job.attempts} of ${job.max_attempts})`, err);
    let after: QueueJob | null = null;
    try {
      after = await fail(job.id, worker, message, !(err instanceof PermanentJobError), now());
    } catch (e) {
      console.error("Couldn't record the failed job", e);
    }
    if (!after) return { ...base, status: "lost", error: message };
    if (after.status === "dead") {
      await jobDied(after, err, handlers, now());
      return { ...base, status: "dead", error: message };
    }
    if (handler?.alertFirstFailure && job.attempts === 1) {
      const name = await restaurantName(job.restaurant_id);
      await alertBuilder(
        `job-failed:${job.id}`,
        `${name}: the ${describe(job)} failed (try 1 of ${job.max_attempts}): ${message}\nIt retries at ${after.run_at}. The owner hasn't been told.`,
      );
    }
    return { ...base, status: "retry", error: message };
  }
}

// Jobs that were stuck (their worker crashed or timed out, so the lock ran out):
// the builder hears about each kind (at most every 6 hours), and any that
// died on their last try are handled as dead.
export async function handleExpired(jobs: QueueJob[], handlers: Record<string, JobHandler>, now?: Date) {
  for (const job of jobs) {
    if (job.status === "dead") await jobDied(job, new Error(job.last_error ?? "The worker stopped"), handlers, now);
    else
      await alertBuilder(
        `job-stuck:${job.type}`,
        `A ${describe(job)} got stuck (its worker crashed or timed out on try ${job.attempts} of ${job.max_attempts}). It's back in the queue.`,
      );
  }
}

// A job has died: its handler's clean-up (e.g. the owner's "Sorry" message) and
// one builder alert. markAlerted makes sure this happens once, however many
// workers notice.
export async function jobDied(job: QueueJob, err: unknown, handlers: Record<string, JobHandler>, now?: Date) {
  try {
    if (!(await markAlerted(job.id, now))) return;
  } catch (e) {
    console.error("Couldn't mark the dead job", e);
    return;
  }
  const handler = handlers[job.type];
  try {
    await handler?.onDead?.(job, err);
  } catch (e) {
    console.error(`The clean-up for dead job ${job.idempotency_key} failed`, e);
  }
  if (handler?.alertOnDead === false) return;
  const name = await restaurantName(job.restaurant_id);
  await alertBuilder(
    `job-dead:${job.id}`,
    `${name}: the ${describe(job)} died after ${job.attempts} ${job.attempts === 1 ? "try" : "tries"}: ${errorText(err).slice(0, 400)}\nRetry it from /log. The owner hasn't been told.`,
  );
}

function describe(job: QueueJob) {
  const step = typeof job.payload?.step === "string" ? ` (${job.payload.step})` : "";
  return `${job.type.replaceAll("_", " ")} job${step}`;
}

async function restaurantName(id: string | null) {
  if (!id) return "System";
  try {
    const { data } = await getSupabase().from("restaurants").select("name").eq("id", id).maybeSingle<{ name: string }>();
    return data?.name ?? id;
  } catch {
    return id;
  }
}
