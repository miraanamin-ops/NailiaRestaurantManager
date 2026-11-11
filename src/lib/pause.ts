import "server-only";
import { logSetting } from "@/lib/audit";
import { releaseQueue } from "@/lib/followups";
import type { Restaurant } from "@/lib/supabase";
import { updateRestaurant } from "@/lib/bot/turn";

// PAUSE and RESUME: one place for WhatsApp's commands (lib/bot/commands.ts) and the
// app's switch (/api/app/pause). Logged as a setting, so UNDO puts it back.
// Resuming sends anything approved that was held, at once.

export async function pauseSending(r: Restaurant) {
  if (r.paused) return { changed: false as const };
  await updateRestaurant(r.id, { paused: true, paused_at: new Date().toISOString() });
  await logSetting(r.id, "paused", false, true, "Paused all sending");
  return { changed: true as const };
}

export async function resumeSending(r: Restaurant, now: Date) {
  if (!r.paused) return { changed: false as const, released: [] as Awaited<ReturnType<typeof releaseQueue>> };
  const resumed = await updateRestaurant(r.id, { paused: false, paused_at: null });
  await logSetting(r.id, "paused", true, false, "Resumed sending");
  return { changed: true as const, released: await releaseQueue(resumed, now) };
}
