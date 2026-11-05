import "server-only";
import { enqueue } from "@/lib/queue/store";
import { kickWorkers } from "@/lib/queue/kick";

// A sync now (after connecting, or "Sync now" on the settings page), rather
// than waiting for the next hourly run. Each request is its own job.
export async function queueTillSync(restaurantId: string, connectionId: string) {
  const job = await enqueue({ type: "till_sync", restaurantId, key: `till_sync:${restaurantId}:now:${connectionId}:${Date.now()}`, priority: 40 });
  try {
    await kickWorkers(1);
  } catch (err) {
    console.error("Couldn't start a worker for the till sync", err);
  }
  return job;
}
