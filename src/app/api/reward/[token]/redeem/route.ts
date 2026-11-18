import type { NextRequest } from "next/server";
import { formatLondon } from "@/lib/clock";
import { scheduleFeedback } from "@/lib/feedback";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { DEVICE_COOKIE, DEVICE_COOKIE_DAYS, parseDeviceCookie, refusalMessage, usedHereByAnother, withEntry } from "@/lib/reward-device-rules";
import { getReward, logEvent, redeemReward, rewardState } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Called when the customer taps "Redeem now". Only the first tap starts the
// 10-minute window; later calls just report the current state.
// One welcome reward per person per restaurant (review G1): a phone that already
// redeemed someone's welcome reward here can't redeem another's (lib/reward-device-rules.ts).
export async function POST(req: NextRequest, ctx: RouteContext<"/api/reward/[token]/redeem">) {
  const { token } = await ctx.params;
  const device = parseDeviceCookie(req.cookies.get(DEVICE_COOKIE)?.value);
  const before = await getReward(token);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  if (!before.redeemed_at && usedHereByAnother(device, before.restaurant_id, before.customer_id)) {
    const { data: r } = await getSupabase().from("restaurants").select("name").eq("id", before.restaurant_id).single<{ name: string }>();
    await logEvent(before.restaurant_id, before.customer_id, "reward_refused", "This phone already redeemed another welcome reward here");
    return Response.json({ error: "already_used", message: refusalMessage(r?.name ?? "this restaurant") }, { status: 409 });
  }

  const { justRedeemed, reward } = await redeemReward(token);
  if (!reward) return Response.json({ error: "not_found" }, { status: 404 });

  if (justRedeemed) {
    const supabase = getSupabase();
    const [{ data: restaurant }, { data: customer }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", reward.restaurant_id).single<Restaurant>(),
      supabase.from("customers").select("name, email").eq("restaurant_id", reward.restaurant_id).eq("id", reward.customer_id).single<{ name: string; email: string }>(),
    ]);
    await logEvent(reward.restaurant_id, reward.customer_id, "redeemed", reward.reward);
    // "How was your visit?" about 3 hours from now.
    await scheduleFeedback({ restaurantId: reward.restaurant_id, customerId: reward.customer_id, source: "reward", sourceId: reward.id, redeemedAt: new Date(reward.redeemed_at!) });
    const channel = restaurant ? ownerChannel(restaurant) : null;
    if (channel && customer) {
      await messageOwner(
        channel,
        `🎁 *Reward redeemed* at ${formatLondon(new Date(reward.redeemed_at!))}\n${customer.name} (${customer.email}) used: *${reward.reward}*`,
        false,
        { opener: "none" },
      );
    }
  }

  const res = Response.json({
    state: rewardState(reward),
    redeemedAt: reward.redeemed_at,
    expiresAt: reward.expires_at,
    serverNow: new Date().toISOString(),
  });
  // This phone remembers the welcome reward it used here.
  if (reward.redeemed_at) {
    const value = withEntry(device, { restaurantId: reward.restaurant_id, customerId: reward.customer_id });
    res.headers.append("Set-Cookie", `${DEVICE_COOKIE}=${value}; Path=/; Max-Age=${DEVICE_COOKIE_DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`);
  }
  return res;
}
