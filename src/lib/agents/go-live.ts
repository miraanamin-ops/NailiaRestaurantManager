import "server-only";
import { logAction } from "@/lib/audit";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { MIN_LIBRARY_PHOTOS, missingForGoLive, PROFILE_FIELDS, type ProfileFieldName } from "@/lib/profile/fields";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { agentModeReason, type LiveAgent } from "@/lib/switches";
import type { AgentName } from "./definition";
import { agentMode, MODES_AVAILABLE } from "./modes";

// The go-live checklist (decision 14): an agent can't leave shadow mode until
// the profile fields it needs are filled. The owner gets one short WhatsApp
// asking for the missing ones (at most once a day).

const PROMPT_EVERY_HOURS = 24;

// Fields the owner has saved at least once (so a default value they kept counts as set).
export async function confirmedFields(restaurantId: string) {
  const { data, error } = await getSupabase().from("profile_versions").select("field").eq("restaurant_id", restaurantId).returns<{ field: string }[]>();
  return new Set(error ? [] : (data ?? []).map((r) => r.field));
}

const label = (f: ProfileFieldName, restaurant: Restaurant) =>
  f === "photo_library" ? `at least ${MIN_LIBRARY_PHOTOS} photos (${(restaurant.photo_library ?? []).length} so far)` : f === "emoji_allowed" ? "emoji setting" : PROFILE_FIELDS[f].label;

export function goLiveChecklist(restaurant: Restaurant, agent: AgentName, confirmed: ReadonlySet<string> = new Set()) {
  const missing = missingForGoLive(restaurant as unknown as Record<string, unknown>, agent, confirmed);
  return { ready: missing.length === 0, missing, labels: missing.map((f) => label(f, restaurant)) };
}

export async function goLiveChecklistFor(restaurant: Restaurant, agent: AgentName) {
  const fields = goLiveChecklist(restaurant, agent, await confirmedFields(restaurant.id));
  if (agent === "gm") {
    // The GM also needs at least one specialist live.
    const { gmChecklist } = await import("./gm");
    const gm = await gmChecklist(restaurant);
    return { ready: gm.ready, missing: fields.missing, labels: gm.labels };
  }
  if (agent !== "insights") return fields;
  // Insights needs data, not profile fields: at least 2 weeks of sales figures.
  const { insightsChecklist } = await import("./insights");
  const data = await insightsChecklist(restaurant);
  return { ready: fields.ready && data.ready, missing: fields.missing, labels: [...fields.labels, ...data.labels] };
}

// "your sign-off name, contact for complaints and halal statement"
function joinLabels(labels: string[]) {
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export function goLivePromptText(restaurant: Restaurant, missing: ProfileFieldName[], agent: AgentName = "reputation") {
  const labels = missing.map((f) => label(f, restaurant));
  if (agent === "visibility") {
    const photos = missing.includes("photo_library") ? " Send photos of your dishes here on WhatsApp any time and they go into your library." : "";
    return `📝 To keep your Google listing fresh for you, I need your ${joinLabels(labels)}. Add them here: ${appUrl()}/settings?r=${restaurant.id}.${photos}`;
  }
  if (agent === "gm") {
    return `📝 To run your messages and morning brief, I need ${joinLabels(labels.map((l) => (l === "your name" ? "your name" : `your ${l}`)))}. Add them here: ${appUrl()}/settings?r=${restaurant.id} ("About you").`;
  }
  if (agent === "growth") {
    return `📝 To draft offers and campaigns for you, I need your ${joinLabels(labels)}. Add them here: ${appUrl()}/settings?r=${restaurant.id} ("Details" and "How your emails look").`;
  }
  return `📝 To reply to your Google reviews for you, I need your ${joinLabels(labels)}. It takes two minutes: ${appUrl()}/settings?r=${restaurant.id} ("How replies and messages sound").`;
}

// Sends the prompt unless one went in the last day. Returns whether it was sent.
export async function promptOwnerForGoLive(restaurant: Restaurant, agent: AgentName) {
  const { missing } = await goLiveChecklistFor(restaurant, agent);
  if (!missing.length) return false;
  const last = restaurant.pilot_prompted_at ? new Date(restaurant.pilot_prompted_at).getTime() : 0;
  if (Date.now() - last < PROMPT_EVERY_HOURS * 60 * 60 * 1000) return false;
  const channel = ownerChannel(restaurant);
  if (!channel) return false;
  await messageOwner(channel, goLivePromptText(restaurant, missing, agent));
  const { error } = await getSupabase().from("restaurants").update({ pilot_prompted_at: new Date().toISOString() }).eq("id", restaurant.id);
  if (error) console.error("Couldn't record the go-live prompt", error);
  await logAction({ restaurantId: restaurant.id, actor: "system", action: "setting", detail: `Asked the owner for the ${agent} go-live details: ${missing.join(", ")}`, data: { field: "pilot_prompted_at" } });
  return true;
}

// For the builder: each agent's set mode, what it really runs as right now (after
// AGENTS_LIVE_ALLOWED and its readiness check), and why, if those differ.
export async function agentStatus(r: Restaurant) {
  const [{ reputationMode }, { visibilityMode }, { insightsMode }, { growthMode }, { gmMode }] = await Promise.all([
    import("./reputation"),
    import("./visibility"),
    import("./insights"),
    import("./growth"),
    import("./gm"),
  ]);
  const running: Record<LiveAgent, string> = {
    reputation: reputationMode(r),
    visibility: await visibilityMode(r),
    insights: await insightsMode(r),
    growth: await growthMode(r),
    gm: await gmMode(r),
  };
  const out: Partial<Record<AgentName, { set: string; running: string; reason: string | null }>> = {};
  for (const agent of Object.keys(MODES_AVAILABLE) as AgentName[]) {
    const set = agentMode(r, agent);
    const now = agent in running ? running[agent as LiveAgent] : set;
    const reason = now !== set ? agentModeReason(process.env, agent as LiveAgent, set, false) : null;
    out[agent] = { set, running: now, reason };
  }
  return out;
}
