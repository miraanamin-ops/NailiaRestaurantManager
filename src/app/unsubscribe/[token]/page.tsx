import { Suspense } from "react";
import type { Metadata } from "next";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { getCustomerByUnsubscribeToken } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

// Linked from every email. One tap on the button removes consent immediately.
// (A button rather than unsubscribing on page load, because some email apps
// open links automatically to scan them, which would unsubscribe people by accident.)
export default function UnsubscribePage({ params, searchParams }: PageProps<"/unsubscribe/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Unsubscribe params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Unsubscribe({ params, searchParams }: Pick<PageProps<"/unsubscribe/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const { done } = await searchParams;
  const customer = await getCustomerByUnsubscribeToken(token);
  if (!customer) return <NotFoundCard />;
  const { data: restaurant } = await getSupabase()
    .from("restaurants")
    .select("*")
    .eq("id", customer.restaurant_id)
    .single<Restaurant>();
  if (!restaurant) return <NotFoundCard />;

  if (customer.unsubscribed_at || done) {
    return (
      <BrandShell restaurant={restaurant}>
        <h2 className="text-xl font-semibold">You&apos;re unsubscribed ✓</h2>
        <p className="mt-3 text-stone-700">
          {customer.email} won&apos;t get any more emails from {restaurant.name}. Sorry to see you go!
        </p>
        <p className="mt-4 text-sm text-stone-500">
          Changed your mind? You can sign up again at the restaurant any time.
        </p>
      </BrandShell>
    );
  }

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">Unsubscribe</h2>
      <p className="mt-3 text-stone-700">
        Stop all emails from {restaurant.name} to <strong>{customer.email}</strong>?
      </p>
      <form method="post" action={`/api/unsubscribe/${token}`} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-full px-6 py-4 text-base font-semibold text-white"
          style={{ background: restaurant.brand_dark }}
        >
          Unsubscribe
        </button>
      </form>
      <p className="mt-4 text-xs text-stone-500">Any reward you&apos;ve already been sent still works.</p>
    </BrandShell>
  );
}
