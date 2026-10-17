import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { MAX_FAILURES, type MorningCarry } from "@/lib/morning";
import { morningGate } from "@/lib/morning-gate";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { analyticsJobsSwitch } from "@/lib/switches";
import { NIGHTLY_MODELS } from "./config";
import { kickWorkers } from "./kick";
import { briefCheckTime, concurrencyKeys, keys, plannedJobs, priorityFor, type MorningStep } from "./rules";
import { enqueue, workersWanted } from "./store";

// The dispatcher: the hourly job (and its daily backup) only QUEUES work, one
// job per restaurant per task, then starts workers. It takes seconds whatever
// the number of restaurants; the work itself runs in the workers, so one slow
// or failing restaurant never delays another.

export async function enqueueMorningStep(restaurantId: string, day: string, step: MorningStep, now: Date, carry: MorningCarry = {}) {
  return enqueue({
    type: "morning",
    restaurantId,
    key: keys.morning(restaurantId, day, step),
    runAt: now,
    priority: priorityFor("morning", now, step),
    concurrencyKey: concurrencyKeys.morning(restaurantId),
    payload: { step, day, carry },
  });
}

export async function dispatch(job: "hourly" | "daily", now: Date) {
  const restaurants = check(await getSupabase().from("restaurants").select("*").eq("active", true).order("created_at").returns<Restaurant[]>()) ?? [];
  const summary: Record<string, unknown>[] = [];
  // The analytics service's models, only once its worker is deployed (ANALYTICS_JOBS).
  const models = analyticsJobsSwitch(process.env).on ? NIGHTLY_MODELS : [];

  const queueFor = async (r: Restaurant) => {
    const entry: Record<string, unknown> = { restaurant: r.id, queued: [] as string[] };
    try {
      const planned = plannedJobs({ id: r.id, hasOwnerChannel: Boolean(ownerChannel(r)) }, job, now, morningGate(r, now, MAX_FAILURES), models);
      for (const p of planned) {
        const created = await enqueue({ type: p.type, restaurantId: r.id, key: p.key, priority: p.priority, concurrencyKey: p.concurrencyKey, payload: p.payload, runAt: p.runAt });
        if (created) (entry.queued as string[]).push(p.type);
      }
    } catch (err) {
      console.error("Couldn't queue a restaurant's jobs", err);
      entry.dispatch = { error: err instanceof Error ? err.message : String(err) };
    }
    return entry;
  };
  // Ten restaurants at a time, so 50 restaurants still take seconds.
  for (let i = 0; i < restaurants.length; i += 10) summary.push(...(await Promise.all(restaurants.slice(i, i + 10).map(queueFor))));

  // System jobs: the 9:31 check that every brief has gone, and the daily clean-up.
  const system: string[] = [];
  try {
    const day = londonYmd(now);
    if (await enqueue({ type: "health_check", restaurantId: null, key: keys.health(day), runAt: briefCheckTime(now) })) system.push("health_check");
    if (await enqueue({ type: "cleanup", restaurantId: null, key: keys.cleanup(day) })) system.push("cleanup");
  } catch (err) {
    console.error("Couldn't queue the system jobs", err);
    summary.push({ restaurant: null, dispatch: { error: err instanceof Error ? err.message : String(err) } });
  }

  // Start enough workers for what's due now (Supabase's every-minute schedule tops them up).
  let started = 0;
  try {
    started = await kickWorkers(await workersWanted());
  } catch (err) {
    console.error("Couldn't start workers", err);
  }
  summary.push({ restaurant: null, system, workersStarted: started });
  return summary;
}
