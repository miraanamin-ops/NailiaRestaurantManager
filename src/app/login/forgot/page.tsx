import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { sendPasswordLink } from "../actions";
import { AuthCard, authButton, authInput, authLabel } from "../ui";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  email: "That doesn't look like an email address.",
  wait: "Too many emails just now. Please wait a few minutes and try again.",
  send: "Couldn't send the email. Please try again.",
};

// "Forgot your password?" (or never set one): we email a link to set a new one.
export default function ForgotPage({ searchParams }: PageProps<"/login/forgot">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Forgot searchParams={searchParams} />
    </Suspense>
  );
}

async function Forgot({ searchParams }: Pick<PageProps<"/login/forgot">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const next = one("next") ?? "/";
  const error = one("error");

  return (
    <AuthCard title="Set a new password">
      {one("sent") ? (
        <p className="mt-3 text-sm text-stone-700">
          📧 If that email is registered, a link to set your password is on its way. It works once and expires after an hour. Check your spam folder if it
          hasn&apos;t arrived in a few minutes.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-600">Enter your email and we&apos;ll send you a link to choose a new password.</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{MESSAGES[error] ?? MESSAGES.send}</p>}
          <form action={sendPasswordLink} className="mt-4 space-y-3">
            <input type="hidden" name="next" value={next} />
            <label className={authLabel} htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={authInput} />
            <button type="submit" data-pending-text="Sending…" className={authButton}>
              Email me a link
            </button>
          </form>
        </>
      )}
      <p className="mt-4 text-center text-sm">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-stone-700 underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
