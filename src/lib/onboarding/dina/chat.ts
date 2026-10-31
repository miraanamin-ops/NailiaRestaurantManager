import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { getSession, loadFlow, startOnboarding } from "../sessions";
import { getRestaurant } from "../store";
import { setupExtras } from "./setup-config";
import { chatFrom, progressFrom, skippableNow, type CardSources, type StoredMessage } from "./view";

// The web chat's state for one restaurant, from what's saved: the conversation,
// the choices made, the step list, and whether "Skip for now" shows.

// The last messages shown when the chat opens (older ones are kept, just not drawn).
const SHOWN = 200;

export async function chatSources(restaurantId: string): Promise<CardSources & { focus: Awaited<ReturnType<typeof getSession>> }> {
  const [restaurant, { state, session }, setup] = await Promise.all([getRestaurant(restaurantId), loadFlow(restaurantId), setupExtras(restaurantId)]);
  return { restaurant, state, focus: session, setup };
}

export async function loadChat(restaurantId: string) {
  if (!(await getSession(restaurantId))) await startOnboarding(restaurantId, { channel: "web" });
  const [sources, rows] = await Promise.all([
    chatSources(restaurantId),
    getSupabase()
      .from("onboarding_messages")
      .select("id, role, body, parts, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(SHOWN)
      .returns<(StoredMessage & { created_at: string })[]>(),
  ]);
  const saved = (check(rows) ?? []).reverse();
  const { messages, chosen } = chatFrom(saved, sources);
  const focus = sources.focus?.current_step ?? null;
  return {
    restaurantName: sources.restaurant.name ?? "",
    messages,
    chosen,
    progress: progressFrom(sources.state, focus),
    skippable: skippableNow(focus),
    needsStart: saved.length === 0,
  };
}
export type ChatState = Awaited<ReturnType<typeof loadChat>>;
