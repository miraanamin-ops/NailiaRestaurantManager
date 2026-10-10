import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { check } from "@/lib/drafts";
import { confirmExpired, getCustomerByConfirmToken, type Reward } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

// Linked from the "confirm your email" message. One tap on the button confirms.
// (A button rather than confirming on page load, because some email apps open
// links by themselves to scan them, which would confirm addresses nobody checked.)
export default function ConfirmPage({ params, searchParams }: PageProps<"/confirm/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Confirm params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Confirm({ params, searchParams }: Pick<PageProps<"/confirm/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const { done } = await searchParams;
  const customer = await getCustomerByConfirmToken(token);
  if (!customer) return <NotFoundCard />;
  const supabase = getSupabase();
  const restaurant = check(await supabase.from("restaurants").select("*").eq("id", customer.restaurant_id).maybeSingle<Restaurant>());
  if (!restaurant) return <NotFoundCard />;

  if (confirmExpired(customer)) {
    return (
      <BrandShell restaurant={restaurant}>
        <h2 className="text-xl font-semibold">This link has expired</h2>
        <p className="mt-3 text-stone-700">Confirm links work for 7 days. Sign up again and we&apos;ll send you a fresh one.</p>
        {restaurant.slug && (
          <Link href={`/r/${restaurant.slug}`} className="mt-6 inline-block underline">
            Sign up again
          </Link>
        )}
      </BrandShell>
    );
  }

  if (customer.email_confirmed_at && (done || !(await hasPendingConsent(restaurant.id, customer.id)))) {
    const reward = check(
      await supabase.from("rewards").select("*").eq("restaurant_id", restaurant.id).eq("customer_id", customer.id).maybeSingle<Reward>(),
    );
    return (
      <BrandShell restaurant={restaurant}>
        <h2 className="text-xl font-semibold">You&apos;re confirmed ✓</h2>
        <p className="mt-3 text-stone-700">
          Thanks, {customer.name}! {customer.marketing_opt_in ? "We'll email you our offers and news. " : ""}
          {reward && !reward.redeemed_at ? `Your reward (${reward.reward}) is waiting. We've emailed it too.` : ""}
        </p>
        {reward && !reward.redeemed_at && (
          <Link
            href={`/reward/${reward.token}`}
            className="mt-6 block w-full rounded-full px-6 py-4 text-center text-base font-semibold"
            style={{ background: restaurant.brand_color, color: "#fff" }}
          >
            Show my reward at the till
          </Link>
        )}
        <p className="mt-4 text-xs text-stone-500">Only tap &quot;Redeem now&quot; on the reward page when you&apos;re at the till.</p>
      </BrandShell>
    );
  }

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">Confirm your email</h2>
      <p className="mt-3 text-stone-700">
        Is <strong>{customer.email}</strong> yours? Tap below to confirm, and we&apos;ll send {restaurant.signup_reward ?? "your welcome reward"} straight over.
      </p>
      <form method="post" action={`/api/confirm/${token}`} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-full px-6 py-4 text-base font-semibold text-white"
          style={{ background: restaurant.brand_color }}
        >
          Confirm my email
        </button>
      </form>
      <p className="mt-4 text-xs text-stone-500">Didn&apos;t sign up? Just close this page: nothing happens unless you tap the button.</p>
    </BrandShell>
  );
}

async function hasPendingConsent(restaurantId: string, customerId: string) {
  const { count } = await getSupabase()
    .from("consents")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("customer_id", customerId)
    .is("confirmed_at", null);
  return (count ?? 0) > 0;
}
