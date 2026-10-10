import { Suspense } from "react";
import type { Metadata } from "next";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { check } from "@/lib/drafts";
import { googleReviewUrl } from "@/lib/email/content";
import { getFeedbackRequest } from "@/lib/feedback";
import { parseRating } from "@/lib/feedback-rules";
import { getSupabase, type Restaurant } from "@/lib/supabase";

export const metadata: Metadata = { title: "How was your visit?", robots: { index: false } };

// Linked from the "How was your visit?" email. Two separate choices, shown to
// everyone the same way: a Google review, and a private note to the owner.
// The Google link never depends on the rating (Google bans asking only happy customers).
export default function FeedbackPage({ params, searchParams }: PageProps<"/feedback/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Feedback params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Feedback({ params, searchParams }: Pick<PageProps<"/feedback/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const request = await getFeedbackRequest(token);
  if (!request) return <NotFoundCard />;
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", request.restaurant_id).maybeSingle<Restaurant>());
  if (!restaurant) return <NotFoundCard />;
  const already = check(
    await getSupabase().from("feedback").select("id").eq("restaurant_id", restaurant.id).eq("request_id", request.id).maybeSingle<{ id: string }>(),
  );
  const google = googleReviewUrl(restaurant);
  const preset = parseRating(one("rating"));

  const googleCard = (
    <div className="mt-6 rounded-xl border border-stone-200 p-4">
      <p className="text-sm text-stone-700">Happy to share your experience publicly? A Google review helps other people find {restaurant.name}.</p>
      <a href={google} target="_blank" rel="noopener" className="mt-3 block w-full rounded-full border-2 px-6 py-3 text-center font-semibold" style={{ borderColor: restaurant.brand_dark, color: restaurant.brand_dark }}>
        Leave a Google review
      </a>
    </div>
  );

  if (one("done") || already) {
    return (
      <BrandShell restaurant={restaurant}>
        <h2 className="text-xl font-semibold">Thank you 🙏</h2>
        <p className="mt-3 text-stone-700">Your feedback has gone straight to the owner. Only they can see it.</p>
        {googleCard}
      </BrandShell>
    );
  }

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">How was your visit?</h2>
      <p className="mt-2 text-sm text-stone-600">Tell the owner privately: only they will see this.</p>
      {one("error") && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{one("error") === "slow" ? "Please wait a moment and try again." : "Please pick a star rating."}</p>}
      <form method="post" action={`/api/feedback/${token}`} className="mt-5 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">Your rating</legend>
          <div className="mt-2 flex justify-between gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex flex-1 cursor-pointer flex-col items-center rounded-xl border border-stone-200 py-2 has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50">
                <input type="radio" name="rating" value={n} defaultChecked={preset === n} required className="sr-only" />
                <span className="text-2xl" aria-hidden="true">⭐</span>
                <span className="text-sm">{n}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 flex justify-between text-xs text-stone-500">
            <span>Not good</span>
            <span>Excellent</span>
          </p>
        </fieldset>
        <label className="block text-sm font-medium">
          Anything you&apos;d like to tell us? <span className="font-normal text-stone-500">(optional)</span>
          <textarea name="comment" maxLength={1000} rows={4} className="mt-1 block w-full rounded-xl border border-stone-300 px-4 py-3 text-base outline-none focus:border-stone-500" />
        </label>
        <button type="submit" className="w-full rounded-full px-6 py-4 text-base font-semibold text-white" style={{ background: restaurant.brand_color }}>
          Send to the owner
        </button>
      </form>
      {googleCard}
    </BrandShell>
  );
}
