import "server-only";
import { aiContext } from "@/lib/ai-context";
import { tokensFrom } from "@/lib/agents/usage";
import { getSupabase } from "@/lib/supabase";

// One line in ai_usage per Claude call (supabase/070), for the founder dashboard's
// costs. Called by lib/claude.ts after every answer, so no call is missed. Never
// throws: a cost line that can't be saved must not break an owner's reply.

type ApiUsage = Parameters<typeof tokensFrom>[1];

export async function recordAiUsage(purpose: string, model: string, usage: ApiUsage, explicitRestaurant?: string | null) {
  try {
    const t = tokensFrom(model, usage);
    const ctx = aiContext();
    const restaurantId = explicitRestaurant ?? ctx.restaurantId ?? null;
    const { error } = await getSupabase()
      .from("ai_usage")
      .insert({
        restaurant_id: restaurantId,
        purpose,
        job_type: ctx.jobType ?? null,
        model,
        input_tokens: t.input,
        output_tokens: t.output,
        cache_read: t.cacheRead,
        cache_write: t.cacheWrite,
        cost_usd: Number(t.cost.toFixed(6)),
      });
    // Before supabase/070 has run the table doesn't exist: nothing to record.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") console.error("Couldn't record a Claude call's cost", error.message);
  } catch (err) {
    console.error("Couldn't record a Claude call's cost", err);
  }
}
