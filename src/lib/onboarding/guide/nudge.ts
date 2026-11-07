import "server-only";
import { appUrl, getSupabase } from "@/lib/supabase";
import { EXTRA_GAPS, isFlowStep, pickNudge, type Gap } from "../flow";

// One setup reminder in the morning brief (the owner's plan, 7 Nov 2026): the most
// useful open gap (flow.ts pickNudge: Google, sales, menu, then the rest), at most
// once a day, as a footnote (it never sends a brief on its own), with a link that
// opens the chat at that step. Three ignored reminders and it's dropped.

const DAY = 86_400_000;

export async function setupNudgeFor(restaurantId: string, now: Date): Promise<{ text: string; gapId: string } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("setup_gaps").select("*").eq("restaurant_id", restaurantId).returns<Gap[]>();
  if (error || !data?.length) return null;
  const { pick, autoDismiss } = pickNudge(data, now);
  if (autoDismiss.length) await supabase.from("setup_gaps").update({ dismissed: true, dismissed_reason: "ignored" }).eq("restaurant_id", restaurantId).in("id", autoDismiss);
  if (!pick || (pick.last_nudged_at && now.getTime() - new Date(pick.last_nudged_at).getTime() < DAY - 3_600_000)) return null;
  const step = isFlowStep(pick.step_key) ? pick.step_key : (EXTRA_GAPS[pick.step_key]?.step ?? null);
  const link = step ? ` ${appUrl()}/onboarding/chat?r=${restaurantId}&step=${step}` : "";
  return { text: `🧩 One thing from setup: ${pick.unlock_text}${link}`, gapId: pick.id };
}

export async function markNudged(restaurantId: string, gapId: string, now: Date) {
  const supabase = getSupabase();
  const { data } = await supabase.from("setup_gaps").select("nudge_count").eq("restaurant_id", restaurantId).eq("id", gapId).maybeSingle<{ nudge_count: number }>();
  await supabase.from("setup_gaps").update({ nudge_count: (data?.nudge_count ?? 0) + 1, last_nudged_at: now.toISOString() }).eq("restaurant_id", restaurantId).eq("id", gapId);
}
