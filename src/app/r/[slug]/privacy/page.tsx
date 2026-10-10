import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandShell, NotFoundCard } from "@/components/brand-shell";
import { getRestaurantBySlug, PRIVACY_VERSION } from "@/lib/signups";

export const metadata: Metadata = { title: "Privacy notice", robots: { index: false } };

export default function PrivacyPage({ params }: PageProps<"/r/[slug]/privacy">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Privacy params={params} />
    </Suspense>
  );
}

// A short, plain-English notice. Keep PRIVACY_VERSION in step with any change.
async function Privacy({ params }: Pick<PageProps<"/r/[slug]/privacy">, "params">) {
  const { slug } = await params;
  const r = await getRestaurantBySlug(slug);
  if (!r) return <NotFoundCard />;

  return (
    <BrandShell restaurant={r}>
      <h2 className="text-xl font-semibold">Privacy notice</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-stone-700">
        <p>
          <strong>Who we are.</strong> {r.name}, {r.address}. Phone {r.phone}. We&apos;re responsible for the
          information you give us when you sign up.
        </p>
        <p>
          <strong>What we collect.</strong> Your first name, email address and, if you choose, your birthday. We also
          keep a record of whether you agreed to marketing emails, the exact wording you saw, and when.
        </p>
        <p>
          <strong>Why.</strong> To send you the welcome reward you asked for. First we email you a link to confirm
          the address is yours: nothing else is sent until you tap it. If you tick the box, we&apos;ll also email you
          offers and news, and use your birthday for a birthday treat. Ticking the box is optional. After you use a
          reward or offer we may email once to ask how your visit was (at most once a month).
        </p>
        <p>
          <strong>Who helps us.</strong> Our website, database and emails are run by trusted providers (DinerAI, with
          Vercel, Supabase and Resend), who only process your details on our behalf. We never sell your details.
        </p>
        <p>
          <strong>How long we keep it.</strong> Until you unsubscribe or ask us to delete it. We keep a record of your
          consent choices for as long as we need to show we followed the rules.
        </p>
        <p>
          <strong>Your choices.</strong> Every email has an unsubscribe link that stops our emails straight away, and
          a &quot;Delete my data&quot; link that removes your name, email address and birthday from our list. You can
          also ask us to see or correct your details by contacting us above. If you&apos;re unhappy,
          you can complain to the Information Commissioner&apos;s Office (ico.org.uk).
        </p>
        <p className="text-xs text-stone-500">Version {PRIVACY_VERSION} · last updated 10 October 2026</p>
      </div>
      <Link href={`/r/${r.slug}`} className="mt-6 inline-block text-sm underline">
        ← Back to sign-up
      </Link>
    </BrandShell>
  );
}
