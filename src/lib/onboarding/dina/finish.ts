import "server-only";
import { logAction } from "@/lib/audit";
import { shouldBeActive } from "@/lib/billing/access";
import { check } from "@/lib/drafts";
import { enqueueBackfill } from "@/lib/feeds/backfill";
import { getSupabase } from "@/lib/supabase";
import { currentStep } from "../flow";
import { getSession, loadFlow } from "../sessions";
import { getRestaurant, updateRestaurantFields } from "../store";

// The end of setup with Dina. Once every step is dealt with (done, half done,
// skipped, or waiting on Google), setup finishes, but only with WhatsApp linked
// (decision 7: the morning brief and alerts arrive there). Finishing:
//   - closes the setup (onboarding_sessions.completed_at) and the older
//     onboarding row too, so WhatsApp goes to the assistant from now on, never
//     back into the older setup conversation
//   - switches the restaurant on if its access allows it (lib/billing/access.ts:
//     a pilot invite code, an exemption, a trial or a subscription), so the
//     scheduled jobs start; nothing runs for a restaurant before this
//   - queues the outside data history for its forecasts
// Safe to call again: it does nothing once finished.

export type FinishOutcome = { finished: true; active: boolean } | { finished: false; needsWhatsapp: boolean };

export async function finishIfDone(restaurantId: string): Promise<FinishOutcome | null> {
  const session = await getSession(restaurantId);
  if (!session || session.completed_at) return null;
  const { state } = await loadFlow(restaurantId);
  if (currentStep(state) !== null) return null;
  const r = await getRestaurant(restaurantId);
  if (!r.owner_whatsapp) return { finished: false, needsWhatsapp: true };

  const now = new Date().toISOString();
  const supabase = getSupabase();
  // Only the first of two at once finishes it.
  const { data: won, error } = await supabase
    .from("onboarding_sessions")
    .update({ completed_at: now, current_step: null, updated_at: now })
    .eq("restaurant_id", restaurantId)
    .is("completed_at", null)
    .select("restaurant_id");
  if (error) throw new Error(error.message);
  if (!won?.length) return null;
  check(await supabase.from("onboarding").update({ completed_at: now, wa_waiting: null }).eq("restaurant_id", restaurantId));
  const active = shouldBeActive(true, r);
  if (active !== r.active) await updateRestaurantFields(restaurantId, { active });
  await logAction({ restaurantId, actor: "owner", action: "setting", detail: `Setup with Dina finished${active ? ": switched on" : " (not switched on: no trial, subscription, pilot code or exemption)"}` });
  try {
    await enqueueBackfill(restaurantId, "created");
  } catch (err) {
    console.error("Couldn't queue the outside data backfill", err);
  }
  return { finished: true, active };
}
