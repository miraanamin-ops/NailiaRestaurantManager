import { Suspense } from "react";
import type { Metadata } from "next";
import { Check } from "@/app/site/_components/bits";
import { Wordmark } from "@/app/site/_components/wordmark";
import { Turnstile } from "@/components/turnstile";
import { fill, site } from "@/content/site";
import { PRICE_GBP, publicSignupOpen, trialDays } from "@/lib/billing/config";
import { turnstileSiteKey } from "@/lib/turnstile";
import { startSignup } from "./actions";
import "../site/landing.css";

export const metadata: Metadata = { title: "Start your free trial · DinerAI" };

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@dinerai.co.uk";

// Step zero: the sign-up form, in the landing page's style. All words are in
// src/content/site.ts (signup). ?invite=CODE fills in a pilot code.
export default function StartPage({ searchParams }: PageProps<"/start">) {
  return (
    <div className="dai-site min-h-dvh bg-ink-950 font-sans text-mist antialiased">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <a href="/site" aria-label="DinerAI">
            <Wordmark />
          </a>
          <a href="/login" className="text-[14px] text-fog hover:text-mist">
            {site.login}
          </a>
        </div>
      </header>
      <Suspense fallback={<div className="min-h-[70dvh]" />}>
        <Start searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Start({ searchParams }: Pick<PageProps<"/start">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const s = site.signup;
  const values = { days: trialDays(), price: PRICE_GBP };
  const t = (text: string) => fill(text, values);
  const siteKey = turnstileSiteKey();
  const invite = one("invite") ?? "";
  const open = publicSignupOpen();
  const inviteFirst = !open || Boolean(invite);
  const error = one("error");
  const input =
    "mt-1.5 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3.5 text-[16px] text-mist placeholder:text-fog/60 outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/30";
  const label = "block text-[14px] font-medium text-mist";

  if (one("sent")) {
    return (
      <main className="relative overflow-hidden">
        <div aria-hidden className="dai-grid absolute inset-0" />
        <div className="relative mx-auto w-full max-w-lg px-4 py-20 text-center sm:py-28">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-signal text-ink-950">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
              <path d="M3 7l9 6 9-6M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          {one("paid") && <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.16em] text-signal">{s.paidTitle}</p>}
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em]">{s.sentTitle}</h1>
          <p className="mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-fog">{s.sentBody}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <h1 className="text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">{open ? s.title : s.inviteTitle}</h1>
        <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-fog">
          {open ? s.intro : s.inviteIntro}
          {!open && (
            <>
              {" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-mist underline decoration-signal underline-offset-4">
                {CONTACT_EMAIL}
              </a>
            </>
          )}
        </p>

        {one("cancelled") && <p className="mt-6 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-[15px] text-mist">{s.cancelled}</p>}
        {error && (
          <p role="alert" className="mt-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-[15px] text-mist">
            {s.errors[error] ?? "Something went wrong. Please try again."}
            {error === "captcha" && one("why") && <span className="mt-1 block text-xs text-fog">(Cloudflare said: {one("why")!.slice(0, 60)})</span>}
          </p>
        )}

        <form action={startSignup} className="mt-8 space-y-5">
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          {inviteFirst && <InviteField value={invite} required={!open} className={input} label={label} />}
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={label}>
              {s.fields.ownerName}
              <input name="owner_name" required autoComplete="name" className={input} />
            </label>
            <label className={label}>
              {s.fields.restaurantName}
              <input name="restaurant_name" required autoComplete="organization" className={input} />
            </label>
          </div>
          <label className={label}>
            {s.fields.email}
            <input name="email" type="email" required autoComplete="email" inputMode="email" className={input} />
          </label>
          <label className={label}>
            {s.fields.whatsapp}
            <input name="whatsapp" type="tel" required autoComplete="tel" inputMode="tel" placeholder="07700 900123" className={input} />
            <span className="mt-1.5 block text-[13px] font-normal text-fog">{s.fields.whatsappHint}</span>
          </label>
          {!inviteFirst && (
            <details className="rounded-xl border border-ink-800 px-4 py-3">
              <summary className="cursor-pointer list-none text-[14px] text-fog">
                {s.fields.inviteHint} <span className="text-signal underline underline-offset-4">{s.fields.invite}</span>
              </summary>
              <div className="pt-3">
                <InviteField value="" required={false} className={input} label={label} />
              </div>
            </details>
          )}
          <label className="flex items-start gap-3 text-[14px] text-mist/90">
            <input type="checkbox" name="terms" value="yes" required className="mt-0.5 h-5 w-5 shrink-0 accent-[#c8f03c]" />
            <span>
              {s.fields.terms.split(/(Terms|Privacy notice)/).map((part, i) =>
                part === "Terms" || part === "Privacy notice" ? (
                  <a key={i} href={part === "Terms" ? "/terms" : "/privacy"} target="_blank" className="underline decoration-signal underline-offset-4">
                    {part}
                  </a>
                ) : (
                  part
                ),
              )}
            </span>
          </label>
          {/* Cloudflare Turnstile: the "I'm human" check. It adds its answer to the form. */}
          {siteKey && <Turnstile siteKey={siteKey} theme="dark" />}
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-signal px-6 py-4 text-[16px] font-semibold text-ink-950 transition hover:bg-[#d6f86a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
          >
            {inviteFirst ? s.submitInvite : s.submit}
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && !invite && <p className="text-[13px] leading-relaxed text-fog">{t(s.after)}</p>}
        </form>
      </div>

      <aside className="h-fit rounded-3xl border border-ink-700 bg-ink-900 p-5 sm:p-6 lg:sticky lg:top-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">{s.stepsLabel}</p>
        <ol className="mt-4 space-y-3">
          {s.steps.map((step, i) => (
            <li key={step} className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[13px] ${i === 0 ? "border-signal bg-signal text-ink-950" : "border-ink-700 text-fog"}`}
              >
                {i + 1}
              </span>
              <span className={i === 0 ? "text-mist" : "text-fog"}>{inviteFirst && i === 1 ? s.pilotStep : t(step)}</span>
            </li>
          ))}
        </ol>
        {!inviteFirst && (
          <ul className="mt-6 space-y-2 border-t border-ink-800 pt-5">
            {s.reassurance.map((r) => (
              <li key={r} className="flex items-center gap-2 text-[14px] text-mist/90">
                <Check className="text-signal" />
                {t(r)}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}

function InviteField({ value, required, className, label }: { value: string; required: boolean; className: string; label: string }) {
  const f = site.signup.fields;
  return (
    <label className={label}>
      {f.invite} {!required && <span className="font-normal text-fog">{f.inviteOptional}</span>}
      <input
        name="invite"
        defaultValue={value}
        required={required}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className={`${className} font-mono uppercase tracking-wider`}
      />
    </label>
  );
}
