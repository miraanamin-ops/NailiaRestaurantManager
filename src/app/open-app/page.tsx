import type { Metadata } from "next";
import { Suspense } from "react";
import { appDeepLink } from "@/lib/app-link";

export const metadata: Metadata = { title: "Open the DinerAI app", robots: { index: false, follow: false } };

// Where "Start in the app" buttons on the dashboard, reports and emails go: a button
// that opens the app's Chat with the message ready, and the words to type if the app
// isn't on this device. Public: it shows nothing but the words in the link.
export default function OpenAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 bg-[#0b0c0a] px-4 py-10 text-[#edefe8]">
      <Suspense fallback={null}>
        <OpenApp searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function OpenApp({ searchParams }: Pick<{ searchParams: Promise<Record<string, string | string[] | undefined>> }, "searchParams">) {
  const raw = (await searchParams).say;
  const say = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 500) ?? "";
  return (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a99d]">DinerAI</p>
      <h1 className="text-2xl font-bold tracking-tight">Open the DinerAI app</h1>
      {say ? (
        <div className="rounded-2xl bg-[#171a14] p-4 ring-1 ring-[#2c3127]">
          <p className="text-[13px] text-[#a3a99d]">Send this in the app&apos;s Chat:</p>
          <p className="mt-1.5 text-[15px] text-[#edefe8]">&ldquo;{say}&rdquo;</p>
        </div>
      ) : (
        <p className="text-[15px] text-[#a3a99d]">Everything waiting for you is in the app: your Inbox to approve, and Chat for anything you want to ask or change.</p>
      )}
      <a href={appDeepLink(say)} className="rounded-full bg-[#c8f03c] px-5 py-3 text-center text-[15px] font-semibold text-[#0b0c0a]">
        Open the app
      </a>
      <p className="text-[13px] leading-relaxed text-[#a3a99d]">
        On a computer, or if the button does nothing: open DinerAI on your phone, go to Chat and type the message above. Log in with the same email and
        password you use here.
      </p>
    </>
  );
}
