import "server-only";
import { logAction } from "@/lib/audit";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { missingForGoLive, PROFILE_FIELDS, type ProfileFieldName } from "@/lib/profile/fields";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import type { AgentName } from "./definition";

// The go-live checklist (decision 14): an agent can't leave shadow mode until
// the profile fields it needs are filled. The owner gets one short WhatsApp
// asking for the missing ones (at most once a day).

const PROMPT_EVERY_HOURS = 24;

export function goLiveChecklist(restaurant: Restaurant, agent: AgentName) {
  const missing = missingForGoLive(restaurant as unknown as Record<string, unknown>, agent);
  return { ready: missing.length === 0, missing, labels: missing.map((f) => PROFILE_FIELDS[f].label) };
}

// "your sign-off name, contact for complaints and halal statement"
function joinLabels(labels: string[]) {
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export function goLivePromptText(restaurant: Pick<Restaurant, "id">, missing: ProfileFieldName[]) {
  const labels = missing.map((f) => PROFILE_FIELDS[f].label);
  return `📝 To reply to your Google reviews for you, I need your ${joinLabels(labels)}. It takes two minutes: ${appUrl()}/settings?r=${restaurant.id} ("How replies and messages sound").`;
}

// Sends the prompt unless one went in the last day. Returns whether it was sent.
export async function promptOwnerForGoLive(restaurant: Restaurant, agent: AgentName) {
  const { missing } = goLiveChecklist(restaurant, agent);
  if (!missing.length) return false;
  const last = restaurant.pilot_prompted_at ? new Date(restaurant.pilot_prompted_at).getTime() : 0;
  if (Date.now() - last < PROMPT_EVERY_HOURS * 60 * 60 * 1000) return false;
  const channel = ownerChannel(restaurant);
  if (!channel) return false;
  await messageOwner(channel, goLivePromptText(restaurant, missing));
  const { error } = await getSupabase().from("restaurants").update({ pilot_prompted_at: new Date().toISOString() }).eq("id", restaurant.id);
  if (error) console.error("Couldn't record the go-live prompt", error);
  await logAction({ restaurantId: restaurant.id, actor: "system", action: "setting", detail: `Asked the owner for the ${agent} go-live details: ${missing.join(", ")}`, data: { field: "pilot_prompted_at" } });
  return true;
}
