import { Suspense } from "react";
import type { Metadata } from "next";
import { NotFoundCard } from "@/components/brand-shell";
import { getReward } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { RewardScreen } from "./reward-screen";

export const metadata: Metadata = { title: "Your reward", robots: { index: false } };

// The one-time "Show at the till" page linked from the welcome email.
export default function RewardPage({ params }: PageProps<"/reward/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Reward params={params} />
    </Suspense>
  );
}

async function Reward({ params }: Pick<PageProps<"/reward/[token]">, "params">) {
  const { token } = await params;
  const reward = await getReward(token);
  if (!reward) return <NotFoundCard />;

  const supabase = getSupabase();
  const [{ data: restaurant }, { data: customer }] = await Promise.all([
    supabase.from("restaurants").select("*").eq("id", reward.restaurant_id).single<Restaurant>(),
    supabase.from("customers").select("name").eq("id", reward.customer_id).single<{ name: string }>(),
  ]);
  if (!restaurant || !customer) return <NotFoundCard />;

  return (
    <RewardScreen
      token={token}
      restaurantName={restaurant.name}
      brandColor={restaurant.brand_color}
      brandDark={restaurant.brand_dark}
      firstName={customer.name}
      reward={reward.reward}
      redeemedAt={reward.redeemed_at}
      expiresAt={reward.expires_at}
      serverNow={new Date().toISOString()}
    />
  );
}
