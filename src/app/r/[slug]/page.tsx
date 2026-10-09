import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { consentWording, getRestaurantBySlug } from "@/lib/signups";

export const metadata: Metadata = { title: "Join us", robots: { index: false } };

const ERRORS: Record<string, string> = {
  name: "Please tell us your first name.",
  email: "Please check your email address.",
  birthday: "That birthday doesn't look right. You can leave it blank.",
};

// The page customers reach by scanning the QR code on the table or till.
export default function SignupPage({ params, searchParams }: PageProps<"/r/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <SignupForm params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SignupForm({ params, searchParams }: Pick<PageProps<"/r/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const { error } = await searchParams;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return <NotFoundCard />;

  const errorText = typeof error === "string" ? ERRORS[error] : undefined;
  const inputClass =
    "mt-1 block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200";

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">Join us and get {restaurant.signup_reward ?? "a welcome treat"} 🎁</h2>
      <p className="mt-2 text-sm text-stone-600">
        Sign up below and we&apos;ll email your reward. Show it at the till on your next visit.
      </p>

      {errorText && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorText}
        </p>
      )}

      <form method="post" action={`/api/signup/${restaurant.slug}`} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">
          First name
          <input name="first_name" required maxLength={50} autoComplete="given-name" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input name="email" type="email" required maxLength={200} autoComplete="email" inputMode="email" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          Birthday <span className="font-normal text-stone-500">(optional, for a birthday treat)</span>
          <input name="birthday" type="date" autoComplete="bday" className={inputClass} />
        </label>

        {/* Hidden from people; catches bots that fill in every field. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-stone-200 p-4 text-sm">
          <input name="consent" type="checkbox" value="yes" className="mt-0.5 h-5 w-5 shrink-0 accent-stone-800" />
          <span>{consentWording(restaurant.name)}</span>
        </label>
        <p className="text-xs text-stone-500">
          Optional. You&apos;ll get your reward either way, and you can unsubscribe at any time.{" "}
          <Link href={`/r/${restaurant.slug}/privacy`} className="underline">
            Privacy notice
          </Link>
        </p>

        <button
          type="submit"
          className="w-full rounded-full px-6 py-4 text-base font-semibold text-white shadow-sm active:scale-[0.99]"
          style={{ background: restaurant.brand_color }}
        >
          Sign up
        </button>
      </form>
    </BrandShell>
  );
}
