import "server-only";
import type { RestaurantContext } from "@/lib/assistant";
import { check } from "@/lib/drafts";
import type { Send } from "@/lib/google-jobs";
import type { OwnerChannel } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Everything about one incoming WhatsApp message that the handlers need.
export type Turn = {
  ctx: RestaurantContext;
  channel: OwnerChannel;
  owner: string; // the owner's WhatsApp number, e.g. whatsapp:+447…
  send: Send;
};

export async function updateRestaurant(id: string, fields: Partial<Restaurant>) {
  const res = await getSupabase().from("restaurants").update(fields).eq("id", id).select("*").single<Restaurant>();
  const row = check(res);
  if (!row) throw new Error("Restaurant not found");
  return row;
}
