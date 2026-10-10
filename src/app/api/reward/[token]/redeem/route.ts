import type { NextRequest } from "next/server";
import { formatLondon } from "@/lib/clock";
import { scheduleFeedback } from "@/lib/feedback";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { logEvent, redeemReward, rewardState } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Called when the customer taps "Redeem now". Only the first tap starts the
// 10-minute window; later calls just report the current state.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/reward/[token]/redeem">) {
  const { token } = await ctx.params;
  const { justRedeemed, reward } = await redeemReward(token);
  if (!reward) return Response.json({ error: "not_found" }, { status: 404 });

  if (justRedeemed) {
    const supabase = getSupabase();
    const [{ data: restaurant }, { data: customer }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", reward.restaurant_id).single<Restaurant>(),
      supabase.from("customers").select("name, email").eq("id", reward.customer_id).single<{ name: string; email: string }>(),
    ]);
    await logEvent(reward.restaurant_id, reward.customer_id, "redeemed", reward.reward);
    // "How was your visit?" about 3 hours from now.
    await scheduleFeedback({ restaurantId: reward.restaurant_id, customerId: reward.customer_id, source: "reward", sourceId: reward.id, redeemedAt: new Date(reward.redeemed_at!) });
    const channel = restaurant ? ownerChannel(restaurant) : null;
    if (channel && customer) {
      await messageOwner(
        channel,
        `🎁 *Reward redeemed* at ${formatLondon(new Date(reward.redeemed_at!))}\n${customer.name} (${customer.email}) used: *${reward.reward}*`,
      );
    }
  }

  return Response.json({
    state: rewardState(reward),
    redeemedAt: reward.redeemed_at,
    expiresAt: reward.expires_at,
    serverNow: new Date().toISOString(),
  });
}
