import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { isSandbox, ourWhatsAppNumber, sandboxJoinPhrase } from "@/lib/onboarding/channel";
import { CONFLICT_REASON, whatsappConflict } from "@/lib/onboarding/entry";
import { showNumber, whatsAppLink } from "@/lib/onboarding/steps";
import { linkCodeFor, loadOnboarding } from "@/app/onboarding/load";
import { button, Card, Frame, LinkWhatsApp, secondary } from "@/app/onboarding/ui";
import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "You're in · DinerAI", robots: { index: false, follow: false } };

// Straight after sign-up: where to set up with Dina. Here in the browser, or on
// WhatsApp (same progress, so the owner can switch later). The number given at
// sign-up is linked by its first message; if that number is already someone
// else's on DinerAI it's never linked automatically: the one-time code instead.
export default function YoureInPage({ searchParams }: PageProps<"/onboarding/in">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <YoureIn searchParams={searchParams} />
    </Suspense>
  );
}

const HELLO = "Hi Dina";

async function YoureIn({ searchParams }: Pick<PageProps<"/onboarding/in">, "searchParams">) {
  const { s, restaurantId } = await loadOnboarding(searchParams, "/onboarding/in");
  const r = s.restaurant;
  const firstName = r.owner_name?.trim().split(/\s+/)[0];
  const pending = s.onboarding.pending_whatsapp;
  const conflict = s.whatsappLinked ? null : await whatsappConflict(pending, restaurantId);
  const ours = ourWhatsAppNumber();
  const join = isSandbox() ? sandboxJoinPhrase() : null;

  return (
    <Frame>
      <h1 className="text-3xl font-bold tracking-tight">You&apos;re in{firstName ? `, ${firstName}` : ""} 🎉</h1>
      <p className="mt-2 text-stone-600">
        I&apos;m Dina, your DinerAI manager (I&apos;m an AI). Let&apos;s set up {r.name} together: about 20 minutes, one question at a time. Where would
        you like to chat?
      </p>

      <div className="mt-6 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold">Carry on here</h2>
          <p className="text-sm text-stone-600">Chat with me in this browser. Good on a laptop, or if you&apos;d rather keep WhatsApp for later.</p>
          <Link href={`/onboarding/chat?r=${restaurantId}`} className={button}>
            Start chatting here
          </Link>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Continue on WhatsApp</h2>
          {s.whatsappLinked ? (
            <>
              <p className="text-sm text-stone-600">Your WhatsApp ({showNumber(r.owner_whatsapp)}) is linked. Say hi and I&apos;ll carry on from where we are.</p>
              <a href={whatsAppLink(ours, HELLO)} className={button}>
                Open WhatsApp
              </a>
            </>
          ) : conflict ? (
            <>
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                The number you gave us ({showNumber(pending)}) {CONFLICT_REASON[conflict]}, so I won&apos;t link it automatically. Send this one-time
                code from the phone you want to use for {r.name} instead.
              </p>
              <LinkWhatsApp code={await linkCodeFor(restaurantId, s.onboarding)} expected={null} />
            </>
          ) : (
            <>
              <p className="text-sm text-stone-600">
                Message me from {pending ? <b>{showNumber(pending)}</b> : "the number you gave us"} and that links it. Everything else happens in
                the chat.
              </p>
              {join ? (
                <ol className="space-y-4">
                  <li className="space-y-2">
                    <p className="text-sm">
                      <b>1.</b> We&apos;re on Twilio&apos;s shared test number for now, so WhatsApp needs you to join it first (once only) by sending
                      this message:
                    </p>
                    <div className="flex items-center gap-2 rounded-xl bg-stone-100 p-3">
                      <code className="flex-1 break-all text-base font-semibold">{join}</code>
                      <CopyButton text={join} />
                    </div>
                    <a href={whatsAppLink(ours, join)} className={secondary}>
                      Open WhatsApp with it filled in
                    </a>
                  </li>
                  <li className="space-y-2">
                    <p className="text-sm">
                      <b>2.</b> Then say hi to me in the same chat ({showNumber(ours)}).
                    </p>
                    <a href={whatsAppLink(ours, HELLO)} className={button}>
                      Say hi to Dina
                    </a>
                  </li>
                </ol>
              ) : (
                <a href={whatsAppLink(ours, HELLO)} className={button}>
                  Open WhatsApp and say hi
                </a>
              )}
              <details className="text-sm text-stone-600">
                <summary className="cursor-pointer">Using a different phone?</summary>
                <div className="mt-3">
                  <LinkWhatsApp code={await linkCodeFor(restaurantId, s.onboarding)} expected={null} />
                </div>
              </details>
            </>
          )}
        </Card>
      </div>
      <p className="mt-6 text-center text-sm text-stone-500">Same progress either way: you can switch whenever you like.</p>
    </Frame>
  );
}
