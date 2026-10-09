import "server-only";
import { queueResultsMessage } from "@/lib/format";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { processQueue } from "@/lib/send";
import type { Restaurant } from "@/lib/supabase";

// (Step 4's 12-hour reminders and the Sunday round-up were replaced in step 8
// by the morning brief, which lists everything still waiting, and the Monday report.)

export function ownerChannel(restaurant: Restaurant): OwnerChannel | null {
  if (!restaurant.owner_whatsapp || !restaurant.whatsapp_from) return null;
  return { restaurantId: restaurant.id, from: restaurant.whatsapp_from, to: restaurant.owner_whatsapp };
}

// Releases any queued drafts that are due and tells the owner what went out.
export async function releaseQueue(restaurant: Restaurant, now: Date) {
  const results = await processQueue(restaurant, now);
  const channel = ownerChannel(restaurant);
  if (results.length && channel) await messageOwner(channel, queueResultsMessage(results));
  return results;
}
