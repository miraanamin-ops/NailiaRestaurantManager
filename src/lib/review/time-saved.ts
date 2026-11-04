import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { MINUTES_SAVED, type SavedAction } from "./config";

// time_saved_log (supabase/058): estimated minutes per piece of work drafted or
// done for the owner, from MINUTES_SAVED. Once per action and ref (a draft id,
// or "<review id>:rivals"), so a retry never counts twice. Totals are always "about".

export async function logTimeSaved(restaurantId: string, action: SavedAction, ref: string, status: "drafted" | "done" = "drafted") {
  const { error } = await getSupabase()
    .from("time_saved_log")
    .upsert({ restaurant_id: restaurantId, action, ref, minutes: MINUTES_SAVED[action], status, logged_at: new Date().toISOString() }, { onConflict: "restaurant_id,action,ref", ignoreDuplicates: status === "drafted" });
  if (error) console.error("Couldn't log the time saved", error.message);
}

async function minutesSince(restaurantId: string, since: string | null) {
  let q = getSupabase().from("time_saved_log").select("minutes").eq("restaurant_id", restaurantId);
  if (since) q = q.gte("logged_at", since);
  const rows = (check(await q) ?? []) as { minutes: number }[];
  return rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
}

// Since the business review started: what its message says was done.
export const minutesSavedSince = (restaurantId: string, since: string) => minutesSince(restaurantId, since);
// Everything so far (the brief and the Monday report).
export const minutesSavedTotal = (restaurantId: string) => minutesSince(restaurantId, null);
