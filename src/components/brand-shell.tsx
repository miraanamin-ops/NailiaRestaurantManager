import type { Restaurant } from "@/lib/supabase";

// Mobile-first page frame in the restaurant's own colours, used by every
// customer-facing page (sign-up, thanks, privacy, unsubscribe).
export function BrandShell({
  restaurant,
  children,
}: {
  restaurant: Pick<Restaurant, "name" | "tagline" | "brand_dark" | "brand_color">;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-5 pb-8 pt-10 text-center text-white" style={{ background: restaurant.brand_dark }}>
        <div className="mx-auto mb-3 h-1 w-12 rounded-full" style={{ background: restaurant.brand_color }} />
        <h1 className="text-2xl font-bold tracking-tight">{restaurant.name}</h1>
        {restaurant.tagline && <p className="mt-1 text-sm text-stone-300">{restaurant.tagline}</p>}
      </header>
      <main className="mx-auto -mt-4 w-full max-w-md px-4 pb-10">
        <div className="rounded-2xl bg-white p-6 shadow-sm">{children}</div>
      </main>
    </div>
  );
}

export function NotFoundCard() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-6 text-center text-stone-700">
      <p>Sorry, we couldn&apos;t find that page. Please check the link or ask a member of staff.</p>
    </div>
  );
}
