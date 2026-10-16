import "server-only";
import { appUrl } from "@/lib/supabase";

// Starts n workers now, each its own function call with its own time budget
// (POST /api/jobs/work answers at once and works in the background). Used when
// work shouldn't wait for the every-minute schedule: an owner's message, and
// the hourly job's batch. Never throws: if it fails, Supabase's every-minute
// schedule still starts a worker.
export async function kickWorkers(n = 1) {
  const secret = process.env.CRON_SECRET;
  if (!secret || n < 1) return 0;
  const url = `${appUrl()}/api/jobs/work`;
  const calls = Array.from({ length: n }, () =>
    fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) })
      .then((res) => res.ok)
      .catch((err) => {
        console.error("Couldn't start a worker", err);
        return false;
      }),
  );
  return (await Promise.all(calls)).filter(Boolean).length;
}
