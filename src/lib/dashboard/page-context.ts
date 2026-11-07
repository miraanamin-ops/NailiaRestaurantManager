import "server-only";
import { connection } from "next/server";
import { pickRestaurantId, requireOwner, restaurantChoices } from "@/lib/auth";
import { check } from "@/lib/drafts";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";

// The start of every owner page: the login (or off to /login), the restaurant this
// person may see (?r= for the builder, who can see several), and the query string.
export async function ownerPage(path: string, searchParams: Promise<Record<string, string | string[] | undefined>>) {
  await connection(); // fresh data on every visit
  const q = await searchParams;
  const one = (k: string) => {
    const v = q[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const owner = await requireOwner(`${path}${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  if (!rid) return { owner, restaurant: null, choices: [], one, now: new Date() } as const;
  const [restaurant, choices] = await Promise.all([
    getSupabase().from("restaurants").select("*").eq("id", rid).maybeSingle<Restaurant>().then(check),
    restaurantChoices(owner),
  ]);
  return { owner, restaurant, choices, one, now: restaurant ? restaurantNow(restaurant) : new Date() } as const;
}
