import "server-only";
import { getSupabase } from "@/lib/supabase";

// The restaurant uses the app (067 app_since): set the first time it signs up or sets
// up in the app. Without WhatsApp, its messages then go to the app (followups.ownerChannel)
// and setup can finish without linking WhatsApp (dina/finish.ts). Before 067: nothing.
export async function markUsesApp(restaurantId: string) {
  const { error } = await getSupabase().from("restaurants").update({ app_since: new Date().toISOString() }).eq("id", restaurantId).is("app_since", null);
  if (error && error.code !== "42703" && error.code !== "PGRST204") console.error("Couldn't mark the restaurant as using the app", error.message);
}
