import "server-only";
import { getSupabase } from "@/lib/supabase";
import { RETENTION } from "./config";

// The job queue's database calls. Every one is a Postgres function in
// supabase/027_job_queue.sql, so the rules (claiming, limits, retries, dead
// jobs) live in one place that our workers and external ones (the Python
// service, through the ext_ functions) share.

export type QueueJob = {
  id: string;
  type: string;
  restaurant_id: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  priority: number;
  run_at: string;
  status: "queued" | "running" | "done" | "dead";
  attempts: number;
  max_attempts: number;
  concurrency_key: string | null;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  alerted_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const iso = (d: Date | undefined) => (d ? d.toISOString() : null);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export type EnqueueInput = {
  type: string;
  restaurantId: string | null;
  key: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  priority?: number;
  concurrencyKey?: string | null;
  maxAttempts?: number;
};

// Adds a job. Returns it, or null if a job with this key already exists.
export async function enqueue(input: EnqueueInput): Promise<QueueJob | null> {
  const rows = await rpc<QueueJob[]>("enqueue_job", {
    p_type: input.type,
    p_restaurant_id: input.restaurantId,
    p_key: input.key,
    p_payload: input.payload ?? {},
    p_run_at: iso(input.runAt),
    p_priority: input.priority ?? 50,
    p_concurrency_key: input.concurrencyKey ?? null,
    p_max_attempts: input.maxAttempts ?? null,
  });
  return rows?.[0] ?? null;
}

export function claim(input: { worker: string; types?: string[] | null; limit?: number; now?: Date; restaurantId?: string | null }) {
  return rpc<QueueJob[]>("claim_jobs", {
    p_worker: input.worker,
    p_types: input.types ?? null,
    p_limit: input.limit ?? 1,
    p_now: iso(input.now),
    p_restaurant_id: input.restaurantId ?? null,
    p_runner: "app",
  }).then((rows) => rows ?? []);
}

export function complete(id: string, worker: string, result: Record<string, unknown> | null, now?: Date) {
  return rpc<boolean>("complete_job", { p_id: id, p_worker: worker, p_result: result, p_now: iso(now) });
}

// Returns the job as it is now: queued again (a retry is due later) or dead.
export async function fail(id: string, worker: string, error: string, retry: boolean, now?: Date) {
  const rows = await rpc<QueueJob[]>("fail_job", { p_id: id, p_worker: worker, p_error: error, p_retry: retry, p_now: iso(now) });
  return rows?.[0] ?? null;
}

export function requeueExpired(now?: Date) {
  return rpc<QueueJob[]>("requeue_expired", { p_now: iso(now) }).then((rows) => rows ?? []);
}

// True only the first time: the builder is told about a dead job once.
export function markAlerted(id: string, now?: Date) {
  return rpc<boolean>("mark_job_alerted", { p_id: id, p_now: iso(now) });
}

export async function retryDead(id: string, now?: Date) {
  const rows = await rpc<QueueJob[]>("retry_job", { p_id: id, p_now: iso(now) });
  return rows?.[0] ?? null;
}

export function cleanup(now?: Date) {
  return rpc<number>("cleanup_jobs", { p_done_days: RETENTION.doneDays, p_dead_days: RETENTION.deadDays, p_now: iso(now) });
}

export function workersWanted(now?: Date) {
  return rpc<number>("workers_wanted", { p_now: iso(now) });
}

export type QueueStat = { restaurant_id: string | null; type: string; queued: number; due: number; retrying: number; running: number; dead: number; oldest_due: string | null };

export async function queueStats(now?: Date): Promise<QueueStat[]> {
  const rows = await rpc<QueueStat[]>("queue_stats", { p_now: iso(now) });
  return (rows ?? []).map((r) => ({ ...r, queued: Number(r.queued), due: Number(r.due), retrying: Number(r.retrying), running: Number(r.running), dead: Number(r.dead) }));
}

// Dead jobs for /log (newest first). The builder's page reads every restaurant.
export function deadJobs(limit = 50) {
  return rpc<QueueJob[]>("dead_jobs", { p_limit: limit }).then((rows) => rows ?? []);
}
