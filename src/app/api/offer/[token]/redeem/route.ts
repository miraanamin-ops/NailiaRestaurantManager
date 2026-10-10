import type { NextRequest } from "next/server";
import { formatDay, redeemOffer } from "@/lib/campaigns";
import { formatLondon } from "@/lib/clock";
import { scheduleFeedback } from "@/lib/feedback";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { logEvent, rewardState } from "@/lib/signups";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";

// "Redeem now" on a campaign offer. Only works on the offer's valid dates,
// and only the first tap starts the 10-minute window.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/offer/[token]/redeem">) {
  const { token } = await ctx.params;
  const supabase = getSupabase();
  const { data: tokenRow } = await supabase.from("campaign_sends").select("restaurant_id").eq("token", token).maybeSingle<{ restaurant_id: string }>();
  if (!tokenRow) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("id", tokenRow.restaurant_id).single<Restaurant>();
  if (!restaurant) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await redeemOffer(token, restaurantNow(restaurant));
  if ("error" in result) {
    if (result.error === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
    const message =
      result.error === "not_yet"
        ? `This offer starts on ${formatDay(result.campaign.valid_from)}.`
        : `This offer ended on ${formatDay(result.campaign.valid_until)}.`;
    return Response.json({ error: result.error, message }, { status: 409 });
  }

  const { send, campaign, justRedeemed } = result;
  if (justRedeemed) {
    const { data: customer } = send.customer_id
      ? await supabase.from("customers").select("name").eq("id", send.customer_id).single<{ name: string }>()
      : { data: null };
    const who = customer ? `${customer.name} (${send.email})` : `Your owner copy (${send.email})`;
    await logEvent(restaurant.id, send.customer_id, "offer_redeemed", `${campaign.name}: ${campaign.offer}`);
    // "How was your visit?" about 3 hours from now (not for the owner's own copy).
    await scheduleFeedback({ restaurantId: restaurant.id, customerId: send.customer_id, source: "offer", sourceId: send.id, redeemedAt: new Date(send.redeemed_at!) });
    const channel = ownerChannel(restaurant);
    if (channel) {
      await messageOwner(
        channel,
        `🎁 *Offer redeemed* at ${formatLondon(new Date(send.redeemed_at!))}\n${who} used *${campaign.offer}* from "${campaign.name}".`,
      );
    }
  }

  return Response.json({
    state: rewardState(send),
    redeemedAt: send.redeemed_at,
    expiresAt: send.expires_at,
    serverNow: new Date().toISOString(),
  });
}
