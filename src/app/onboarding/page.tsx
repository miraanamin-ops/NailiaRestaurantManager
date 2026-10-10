import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { qrPackUrl, summaryLines } from "@/lib/onboarding/engine";
import { STEPS } from "@/lib/onboarding/steps";
import { isTestMode } from "@/lib/test-mode";
import { resetSetup } from "./actions";
import { loadOnboarding } from "./load";
import { button, Card, Frame, secondary } from "./ui";

export const metadata: Metadata = { title: "Set up Naila", robots: { index: false, follow: false } };

// After logging in from the sign-up email: set up here, or on WhatsApp.
// Once finished, the same address shows the summary and the QR pack.
export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Choice searchParams={searchParams} />
    </Suspense>
  );
}

async function Choice({ searchParams }: Pick<PageProps<"/onboarding">, "searchParams">) {
  const { s, restaurantId } = await loadOnboarding(searchParams, "/onboarding");
  const r = s.restaurant;

  if (s.onboarding.completed_at) {
    return (
      <Frame>
        <h1 className="text-2xl font-bold tracking-tight">🎉 {r.name} is set up</h1>
        <p className="mt-1 text-stone-600">We&apos;ve sent this summary to your WhatsApp too.</p>
        <div className="mt-5">
          <Card>
            <ul className="space-y-2 text-stone-800">
              {summaryLines(r, s.onboarding).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <a href={qrPackUrl(r).replace(/^https?:\/\/[^/]+/, "")} className={button} target="_blank" rel="noreferrer">
              🖨️ Print my QR codes
            </a>
            <p className="text-sm text-stone-600">Table cards and a counter sign. Customers scan them to join your list and get {r.signup_reward ?? "a welcome treat"}.</p>
            <Link href={`/?r=${restaurantId}`} className={secondary}>
              Go to my dashboard
            </Link>
            <Link href={`/settings?r=${restaurantId}`} className="block text-center text-sm font-medium text-emerald-700 underline">
              Change hours, menu or anything else
            </Link>
          </Card>
        </div>
        {isTestMode() && r.is_demo && (
          <form action={resetSetup} className="mt-8 text-center">
            <input type="hidden" name="r" value={restaurantId} />
            <button className="text-sm text-stone-500 underline">🧪 Test mode: reset and set up again</button>
          </form>
        )}
      </Frame>
    );
  }

  const started = s.done > 0;
  return (
    <Frame>
      <h1 className="text-2xl font-bold tracking-tight">
        Hi{r.owner_name ? ` ${r.owner_name.split(" ")[0]}` : ""}! Let&apos;s set up {r.name}
      </h1>
      <p className="mt-1 text-stone-600">
        {STEPS.length} short steps, under 10 minutes. We find what we can (Google, your menu, your website), so mostly you just check it. You can
        switch between here and WhatsApp at any point.
      </p>
      <div className="mt-6 space-y-3">
        <Link href={`/onboarding/setup?r=${restaurantId}`} className={button}>
          {started ? `Carry on here (step ${Math.min(s.done + 1, s.total)} of ${s.total})` : "Set up here"}
        </Link>
        <Link href={`/onboarding/whatsapp?r=${restaurantId}`} className={secondary}>
          {started ? "Carry on in WhatsApp" : "Set up on WhatsApp"}
        </Link>
      </div>
      <p className="mt-4 text-sm text-stone-500">Either way, Naila runs on your WhatsApp, so you&apos;ll link your number before you finish.</p>
    </Frame>
  );
}
