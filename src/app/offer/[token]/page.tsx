import { Suspense } from "react";
import type { Metadata } from "next";
import { NotFoundCard } from "@/components/brand-shell";
import { formatDay, getSendByToken, markClicked, offerValidity } from "@/lib/campaigns";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";
import { RewardScreen } from "../../reward/[token]/reward-screen";

export const metadata: Metadata = { title: "Your offer", robots: { index: false } };

// Each customer's own one-time link from a campaign email.
export default function OfferPage({ params }: PageProps<"/offer/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Offer params={params} />
    </Suspense>
  );
}

async function Offer({ params }: Pick<PageProps<"/offer/[token]">, "params">) {
  const { token } = await params;
  const found = await getSendByToken(token);
  if (!found) return <NotFoundCard />;
  const { send, campaign } = found;

  const supabase = getSupabase();
  const [{ data: restaurant }, { data: customer }] = await Promise.all([
    supabase.from("restaurants").select("*").eq("id", send.restaurant_id).single<Restaurant>(),
    send.customer_id
      ? supabase.from("customers").select("name").eq("id", send.customer_id).single<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);
  if (!restaurant) return <NotFoundCard />;

  await markClicked(token);

  // Valid dates follow the restaurant's clock, so the TIME test command works here too.
  const validity = offerValidity(campaign, restaurantNow(restaurant));
  const unavailable =
    send.redeemed_at || validity === "ok"
      ? null
      : validity === "not_yet"
        ? { title: `Valid from ${formatDay(campaign.valid_from)}`, message: "Come back on that day and show this at the till." }
        : { title: "This offer has ended", message: `It was valid until ${formatDay(campaign.valid_until)}. Keep an eye on your inbox for the next one!` };

  return (
    <RewardScreen
      token={token}
      restaurantName={restaurant.name}
      brandColor={restaurant.brand_color}
      brandDark={restaurant.brand_dark}
      firstName={customer?.name.split(/\s+/)[0] ?? "there"}
      reward={campaign.offer}
      redeemedAt={send.redeemed_at}
      expiresAt={send.expires_at}
      serverNow={new Date().toISOString()}
      redeemPath={`/api/offer/${token}/redeem`}
      label="your offer"
      unavailable={unavailable}
    />
  );
}
