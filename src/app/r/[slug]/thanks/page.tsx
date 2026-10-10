import { Suspense } from "react";
import type { Metadata } from "next";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { getRestaurantBySlug } from "@/lib/signups";

export const metadata: Metadata = { title: "Thanks for joining", robots: { index: false } };

export default function ThanksPage({ params, searchParams }: PageProps<"/r/[slug]/thanks">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Thanks params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Thanks({ params, searchParams }: Pick<PageProps<"/r/[slug]/thanks">, "params" | "searchParams">) {
  const { slug } = await params;
  const { status, email } = await searchParams;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return <NotFoundCard />;

  const reward = restaurant.signup_reward ?? "your welcome treat";
  // Double opt-in: after signing up, the reward arrives once the email is confirmed.
  let title = "Check your inbox 📬";
  let body = `We've sent you an email. Tap "Confirm my email" in it and ${reward} is yours.`;
  if (status === "reconfirm") {
    title = "We've sent the link again 📬";
    body = `You signed up before but haven't confirmed yet. Tap "Confirm my email" in the email we've just sent to get ${reward}.`;
  } else if (status === "consent") {
    title = "One more tap 📬";
    body = "You're already signed up. To start getting offers by email, tap the confirm link in the email we've just sent.";
  } else if (status === "limit") {
    title = "We've already emailed you";
    body = "We've sent a few emails to this address today, so we haven't sent another. Please check your inbox (and spam folder) for the earlier one.";
  } else if (status === "repeat") {
    title = "You're already signed up 👋";
    body = `We've sent your reward email again. Open it at the till to claim ${reward}.`;
  } else if (status === "used") {
    title = "Welcome back 👋";
    body = "You're already signed up, and you've already used your welcome reward. Thanks for coming back!";
  }

  return (
    <BrandShell restaurant={restaurant}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-stone-700">{body}</p>
      {email === "failed" && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We couldn&apos;t send the email just now. Please let a member of staff know and they&apos;ll sort it out.
        </p>
      )}
      <p className="mt-6 text-sm text-stone-500">Can&apos;t see it? Check your spam or promotions folder.</p>
    </BrandShell>
  );
}
