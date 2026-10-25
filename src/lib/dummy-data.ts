import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { testToolsOn } from "@/lib/test-mode";

// May the pilot contracts (docs/pilot-sprint.md) fill a gap with dummy data for
// this restaurant? Only with the test tools on, and only for a demo restaurant
// (read from the restaurant row itself, so a caller can't claim it).
export async function dummyDataAllowed(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("is_demo").eq("id", restaurantId).maybeSingle<{ is_demo: boolean | null }>());
  return testToolsOn(r ?? {});
}
