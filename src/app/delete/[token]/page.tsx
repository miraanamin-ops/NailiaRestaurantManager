import { Suspense } from "react";
import type { Metadata } from "next";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { check } from "@/lib/drafts";
import { getCustomerByUnsubscribeToken } from "@/lib/signups";
import { getSupabase, type Restaurant } from "@/lib/supabase";

export const metadata: Metadata = { title: "Delete my data", robots: { index: false } };

// Linked from every email's footer. One tap on the button deletes (a button, not
// on page load, so email apps that scan links can't delete anyone by accident).
export default function DeletePage({ params, searchParams }: PageProps<"/delete/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Delete params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Delete({ params, searchParams }: Pick<PageProps<"/delete/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const { done } = await searchParams;
  const customer = await getCustomerByUnsubscribeToken(token);
  if (!customer) return <NotFoundCard />;
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", customer.restaurant_id).maybeSingle<Restaurant>());
  if (!restaurant) return <NotFoundCard />;

  if (customer.deleted_at || done) {
    return (
      <BrandShell restaurant={restaurant}>
        <h2 className="text-xl font-semibold">Your data has been deleted ✓</h2>
        <p className="mt-3 text-stone-700">
          {restaurant.name} no longer has your name, email address or birthday, and you won&apos;t get any more emails from them.
        </p>
        <p className="mt-4 text-sm text-stone-500">
          We keep anonymous numbers (for example, that a reward was used) with nothing that identifies you. You&apos;re welcome to sign up again any time.
        </p>
      </BrandShell>
    );
  }

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">Delete my data</h2>
      <p className="mt-3 text-stone-700">
        This removes your name, email address (<strong>{customer.email}</strong>) and birthday from {restaurant.name}&apos;s customer list and stops all
        emails. It can&apos;t be undone.
      </p>
      <form method="post" action={`/api/delete/${token}`} className="mt-6">
        <button type="submit" className="w-full rounded-full bg-red-700 px-6 py-4 text-base font-semibold text-white">
          Delete my data
        </button>
      </form>
      <p className="mt-4 text-xs text-stone-500">Any reward you haven&apos;t used yet will stop working.</p>
    </BrandShell>
  );
}
