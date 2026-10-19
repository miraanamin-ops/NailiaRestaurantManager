import "server-only";
import { getSupabase } from "@/lib/supabase";
import { SEED_VENUES } from "./venue-seeds";

// The big venues near our restaurants, added once if they aren't there (a
// venue with the same name, e.g. from the synthetic data, is left as it is,
// apart from a typical crowd it doesn't have yet). Run by the events and
// football feeds before they look venues up.
export async function ensureVenues() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("venues").select("id, name, typical_crowd").returns<{ id: string; name: string; typical_crowd: number | null }[]>();
  if (error) throw new Error(`venues: ${error.message}`);
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  let added = 0;
  for (const v of SEED_VENUES) {
    const found = (data ?? []).find((x) => key(x.name) === key(v.name));
    if (!found) {
      const { error: e } = await supabase.from("venues").insert({ ...v, source: "builder" });
      if (e && e.code !== "23505") throw new Error(`venues: ${e.message}`);
      if (!e) added++;
    } else if (found.typical_crowd == null) {
      await supabase.from("venues").update({ typical_crowd: v.typical_crowd }).eq("id", found.id);
    }
  }
  return added;
}
