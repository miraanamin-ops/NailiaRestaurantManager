import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { showNumber, whatsAppLink } from "@/lib/onboarding/steps";
import { linkCodeFor, loadOnboarding } from "../load";
import { button, Card, Frame, LinkWhatsApp, Progress } from "../ui";

export const metadata: Metadata = { title: "Set up on WhatsApp", robots: { index: false, follow: false } };

// "Set up on WhatsApp" / "Finish on WhatsApp instead": link the number (if it
// isn't yet) by sending the one-time code; the conversation carries on from
// whichever step the owner is on.
export default function WhatsAppSetupPage({ searchParams }: PageProps<"/onboarding/whatsapp">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <WhatsAppSetup searchParams={searchParams} />
    </Suspense>
  );
}

async function WhatsAppSetup({ searchParams }: Pick<PageProps<"/onboarding/whatsapp">, "searchParams">) {
  const { s, restaurantId } = await loadOnboarding(searchParams, "/onboarding/whatsapp");
  const linked = s.whatsappLinked;

  return (
    <Frame>
      <Progress step={s.step} done={s.done} total={s.total} />
      <h1 className="text-2xl font-bold tracking-tight">Set up on WhatsApp</h1>
      <div className="mt-5">
        <Card>
          {linked ? (
            <>
              <p>
                ✅ Your WhatsApp ({showNumber(s.restaurant.owner_whatsapp)}) is linked. Send any message and Naila carries on from{" "}
                {s.done ? "where you got to" : "the first step"}.
              </p>
              <a href={whatsAppLink(ourWhatsAppNumber(), "Carry on setting up")} className={button}>
                Open WhatsApp
              </a>
            </>
          ) : (
            <>
              <p>Link your WhatsApp and Naila will take you through the rest there. It takes a few seconds.</p>
              <LinkWhatsApp code={await linkCodeFor(restaurantId, s.onboarding)} expected={s.onboarding.pending_whatsapp} />
            </>
          )}
        </Card>
      </div>
      <p className="mt-6 text-center text-sm">
        <Link href={`/onboarding/setup?r=${restaurantId}`} className="font-medium text-emerald-700 underline">
          Set up here in the browser instead
        </Link>
      </p>
    </Frame>
  );
}
