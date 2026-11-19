import "server-only";
import { getSupabase } from "@/lib/supabase";
import { getOnboarding } from "./store";
import { getSession, startOnboarding } from "./sessions";

// The older six-step setup (engine.ts, whatsapp-flow.ts, the /onboarding/setup wizard)
// is retired (security review AR1, 18 Nov 2026): there is one setup, Dina's chapters.
// A restaurant still part-way through the older setup is moved into the chapters the
// next time its owner messages or opens setup. Nothing they saved is lost: the
// chapters show what's already saved as picked, for the owner to confirm.
// The older files stay for one release so nothing breaks mid-way, then go.

// True when this restaurant was moved (or was already) on Dina's setup and isn't finished.
export async function moveOldSetupToDina(restaurantId: string): Promise<boolean> {
  const session = await getSession(restaurantId);
  if (session) return !session.completed_at;
  const old = await getOnboarding(restaurantId).catch(() => null);
  if (!old || old.completed_at) return false;
  // A running restaurant is never put back into setup (e.g. a demo whose old row was reset).
  const { data } = await getSupabase().from("restaurants").select("active").eq("id", restaurantId).maybeSingle<{ active: boolean }>();
  if (!data || data.active) return false;
  await startOnboarding(restaurantId);
  return true;
}
