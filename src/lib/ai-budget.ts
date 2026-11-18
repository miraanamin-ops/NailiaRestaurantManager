import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { startOfLondonDay } from "@/lib/clock";
import { DAY, limitKey, overLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";
import { budgetVerdict, DEFAULT_CHAT_PER_HOUR, DEFAULT_DAILY_CAP_USD, positiveNumber, REFUSAL_TEXT, type BudgetVerdict } from "./ai-budget-rules";

// The AI limits for an owner's typed message (rules in ai-budget-rules.ts). Called by
// handleMessage (lib/bot/index.ts) before anything that may call Claude, for both
// WhatsApp and the app's Chat tab. Settings (Vercel): AI_DAILY_CAP_USD (default 3)
// and AI_CHAT_PER_HOUR (default 60), the same for every restaurant.
// If the numbers can't be read, the owner is let through (never locked out by an outage).

export async function chatBudget(restaurantId: string, now = new Date()): Promise<BudgetVerdict> {
  try {
    const capUsd = positiveNumber(process.env.AI_DAILY_CAP_USD, DEFAULT_DAILY_CAP_USD);
    const perHour = positiveNumber(process.env.AI_CHAT_PER_HOUR, DEFAULT_CHAT_PER_HOUR);
    const overHourly = await overLimit([{ key: limitKey("chat", restaurantId), max: perHour, windowMs: DAY / 24 }], now);
    const spentToday = await spentSince(restaurantId, startOfLondonDay(now));
    const verdict = budgetVerdict({ overHourly, spentToday, capUsd });
    if (!verdict.ok && verdict.why === "budget") {
      await alertBuilder(
        `ai-budget:${restaurantId}`,
        `A restaurant hit its daily AI cap ($${spentToday.toFixed(2)} of $${capUsd}). Chat is paused for it until midnight; scheduled work carries on.`,
        { restaurantId },
      );
    } else if (verdict.ok && verdict.warn) {
      await alertBuilder(`ai-budget-warn:${restaurantId}`, `A restaurant has used $${spentToday.toFixed(2)} of its $${capUsd} daily AI cap.`, { restaurantId });
    }
    return verdict;
  } catch (err) {
    console.error("AI budget check failed; letting the message through", err);
    return { ok: true, warn: false };
  }
}

export function refusalText(why: "busy" | "budget") {
  return REFUSAL_TEXT[why];
}

async function spentSince(restaurantId: string, since: Date) {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabase()
      .from("ai_usage")
      .select("cost_usd")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since.toISOString())
      .range(from, from + 999)
      .returns<{ cost_usd: number | string | null }[]>();
    // Before supabase/070 the table doesn't exist: nothing spent that we know of.
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return 0;
      throw error;
    }
    for (const r of data ?? []) total += Number(r.cost_usd ?? 0);
    if (!data || data.length < 1000) return total;
  }
}
