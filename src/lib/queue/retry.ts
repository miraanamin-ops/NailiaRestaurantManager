import "server-only";
import { logAction } from "@/lib/audit";
import { kickWorkers } from "./kick";
import { retryDead } from "./store";

// The builder's Retry button on /log: a dead job goes back in the queue with
// fresh attempts, the audit log records who did it, and a worker starts.
// Returns false if the job wasn't dead (already retried, or cleaned up).
export async function retryDeadJob(id: string, by: string) {
  const job = await retryDead(id);
  if (!job) return false;
  await logAction({
    restaurantId: job.restaurant_id,
    actor: "builder",
    action: "job_retried",
    detail: `Retried the ${job.type.replaceAll("_", " ")} job${typeof job.payload?.step === "string" ? ` (${job.payload.step})` : ""} that had stopped (by ${by})`,
    data: { job_id: job.id, key: job.idempotency_key, last_error: job.last_error },
  });
  await kickWorkers(1);
  return true;
}
