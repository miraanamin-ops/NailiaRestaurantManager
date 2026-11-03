import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { NotFoundCard } from "@/components/brand-shell";
import { requireOwner } from "@/lib/auth";
import { reviewPageFor } from "@/lib/review/page-data";

export const metadata: Metadata = { title: "Your business review", robots: { index: false } };

// The business review in full (the WhatsApp message links here). Owner page:
// needs a login, and only shows a restaurant this person may see.
export default function ReviewPage({ params }: PageProps<"/review/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: Pick<PageProps<"/review/[slug]">, "params">) {
  const { slug } = await params;
  await connection();
  const owner = await requireOwner(`/review/${slug}`);
  const page = await reviewPageFor(owner, slug);
  if (!page) return <NotFoundCard />;
  const { restaurant, review, lines } = page;
  const brand = restaurant.brand_color ?? "#c2410c";

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-4 pb-10 pt-8 text-white" style={{ background: restaurant.brand_dark ?? "#1c1917" }}>
        <div className="mx-auto max-w-xl">
          <div className="mb-3 h-1 w-10 rounded-full" style={{ background: brand }} />
          <p className="text-sm text-stone-300">Business review</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{restaurant.name}</h1>
        </div>
      </header>
      <main className="mx-auto -mt-5 w-full max-w-xl space-y-4 px-4 pb-12">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          {!review ? (
            <p>Dina hasn&apos;t reviewed this restaurant yet.</p>
          ) : review.status === "queued" || review.status === "running" || review.status === "sending" ? (
            <p>Dina is reviewing your business now. This page fills in within about 10 minutes.</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
