import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Every write to Google is keyed on the job that made it ("reply:<draft id>",
// "post:<draft id>", "hours:<draft id>"), in google_writes. A job that runs
// again (a retry, a duplicate delivery, a worker that died half-way) never
// writes twice:
//   done     -> the saved result is returned, Google isn't called again
//   pending  -> another run is mid-way (or died mid-way): `find` checks Google
//               for what that run may already have made; if nothing, it's
//               retried once the other run has had STALE_MS to finish
//   failed   -> tried again
export const STALE_MS = 2 * 60_000;

export class WriteInProgressError extends Error {
  constructor(key: string) {
    super(`Google write ${key} is already in progress`);
    this.name = "WriteInProgressError";
  }
}

type WriteRow = { id: string; status: "pending" | "done" | "failed"; attempts: number; result: unknown; updated_at: string };

export async function onceOnGoogle<T>(
  input: { restaurantId: string; key: string; action: string },
  write: () => Promise<T>,
  find?: () => Promise<T | null>,
): Promise<T> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  // Claim the key: the unique index lets exactly one run insert it.
  const inserted = await supabase
    .from("google_writes")
    .insert({ restaurant_id: input.restaurantId, key: input.key, action: input.action, status: "pending" })
    .select("id, status, attempts, result, updated_at")
    .maybeSingle<WriteRow>();
  let row: WriteRow | null = inserted.error ? null : inserted.data;
  if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);

  if (!row) {
    const prev = check(
      await supabase.from("google_writes").select("id, status, attempts, result, updated_at").eq("restaurant_id", input.restaurantId).eq("key", input.key).maybeSingle<WriteRow>(),
    );
    if (!prev) throw new Error(`Google write ${input.key} vanished`);
    if (prev.status === "done") return prev.result as T;
    if (prev.status === "pending") {
      const already = find ? await find() : null;
      if (already) {
        check(await supabase.from("google_writes").update({ status: "done", result: already as object, updated_at: now }).eq("id", prev.id));
        return already;
      }
      if (Date.now() - new Date(prev.updated_at).getTime() < STALE_MS) throw new WriteInProgressError(input.key);
    }
    // Take it over (failed, or pending and stale), only if nobody else just did.
    const taken = check(
      await supabase
        .from("google_writes")
        .update({ status: "pending", attempts: prev.attempts + 1, error: null, updated_at: now })
        .eq("id", prev.id)
        .eq("updated_at", prev.updated_at)
        .select("id, status, attempts, result, updated_at")
        .maybeSingle<WriteRow>(),
    );
    if (!taken) throw new WriteInProgressError(input.key);
    row = taken;
  }

  try {
    const result = await write();
    check(await supabase.from("google_writes").update({ status: "done", result: (result ?? null) as object | null, updated_at: new Date().toISOString() }).eq("id", row.id));
    return result;
  } catch (err) {
    await supabase
      .from("google_writes")
      .update({ status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", row.id);
    throw err;
  }
}
