import "server-only";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { getOnboarding, getRestaurant, isComplete, updateRestaurantFields } from "@/lib/onboarding/store";
import { billingStanding, shouldBeActive } from "./access";

// Switches a restaurant on or off to match the access rule (lib/billing/access.ts).
// Called when onboarding finishes and after every Stripe event. Returns whether
// it's active now.
export async function syncActive(restaurantId: string): Promise<boolean> {
  const r = await getRestaurant(restaurantId);
  const finished = isComplete(await getOnboarding(restaurantId));
  const want = shouldBeActive(finished, r);
  if (want === r.active) return want;

  await updateRestaurantFields(restaurantId, { active: want });
  const { standing } = billingStanding(r);
  const detail = want ? `Switched on (${standing})` : `Switched off: ${finished ? "no trial or subscription" : "onboarding not finished"}`;
  await logAction({ restaurantId, actor: "stripe", action: "billing", detail, data: { active: want, standing } });
  if (!want) await alertBuilder(`billing:off:${restaurantId}`, `${r.name} is switched off (${standing}). Scheduled jobs stop; its data is kept.`);
  return want;
}
