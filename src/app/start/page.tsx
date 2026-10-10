import { Suspense } from "react";
import type { Metadata } from "next";
import { Turnstile } from "@/components/turnstile";
import { turnstileSiteKey } from "@/lib/turnstile";
import { startSignup } from "./actions";

export const metadata: Metadata = { title: "Start with Naila" };

const ERRORS: Record<string, string> = {
  missing: "Please fill in your name and your restaurant's name.",
  email: "That doesn't look like an email address.",
  whatsapp: "Please check your WhatsApp number (e.g. 07700 900123).",
  wait: "Too many login emails just now. Please wait a minute and try again.",
  send: "Couldn't send the login email. Please try again.",
  captcha: "Please complete the \"I'm human\" check and try again.",
  slow: "Too many sign-ups from this connection just now. Please try again later.",
};

// Step zero of onboarding: about a minute. Everything else we try to find ourselves.
export default function StartPage({ searchParams }: PageProps<"/start">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Start searchParams={searchParams} />
    </Suspense>
  );
}

async function Start({ searchParams }: Pick<PageProps<"/start">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const input = "w-full rounded-xl border border-stone-300 px-4 py-3 text-base";
  const siteKey = turnstileSiteKey();

  return (
    <div className="min-h-dvh bg-stone-100 px-4 py-8 text-stone-900">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-bold tracking-tight">Get your restaurant set up</h1>
        <p className="mt-1 text-stone-600">About a minute here, then we do the hard work: finding you on Google, reading your menu and learning how you sound.</p>
        {one("sent") ? (
          <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-lg font-semibold">📧 Check your email</p>
            <p className="mt-2 text-stone-700">
              We&apos;ve sent a login link{one("email") ? ` to ${one("email")}` : ""}. Tap it on this phone and you&apos;ll go straight to setting up.
            </p>
          </div>
        ) : (
          <form action={startSignup} className="mt-6 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            {one("error") && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {ERRORS[one("error")!] ?? "Something went wrong. Please try again."}
                {one("error") === "captcha" && one("why") && <span className="mt-1 block text-xs opacity-75">(Cloudflare said: {one("why")!.slice(0, 60)})</span>}
              </p>
            )}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
            <label className="block">
              <span className="text-sm font-medium">Your name</span>
              <input name="owner_name" required autoComplete="name" className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Your email</span>
              <input name="email" type="email" required autoComplete="email" inputMode="email" className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Restaurant name</span>
              <input name="restaurant_name" required autoComplete="organization" className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Your WhatsApp number</span>
              <input name="whatsapp" type="tel" required autoComplete="tel" inputMode="tel" placeholder="07700 900123" className={`mt-1 ${input}`} />
              <span className="mt-1 block text-xs text-stone-500">Naila runs on WhatsApp: drafts, approvals and your morning brief.</span>
            </label>
            {/* Cloudflare Turnstile: the "I'm human" check. It adds its answer to the form. */}
            {siteKey && <Turnstile siteKey={siteKey} />}
            <button type="submit" className="w-full rounded-xl bg-stone-900 px-4 py-4 text-base font-semibold text-white">
              Start setting up
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
