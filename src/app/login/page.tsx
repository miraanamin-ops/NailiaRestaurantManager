import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { logIn } from "./actions";
import { AuthCard, authButton, authInput, authLabel } from "./ui";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  wrong: "Wrong email or password. If you've never set a password, use “Forgot your password?” below.",
  slow: "Too many tries just now. Please wait 15 minutes and try again.",
  expired: "That link has expired or was already used. Ask for a new one with “Forgot your password?”.",
  exists: "You already have an account with that email. Log in below, or set a new password if you've forgotten it.",
};

// Owner login: email and password. A link by email only to set or reset a password.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Login searchParams={searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const next = one("next") ?? "/";
  const error = one("error");

  return (
    <AuthCard title="Log in">
      {one("out") && <p className="mt-1 text-sm text-stone-600">You&apos;re logged out.</p>}
      {one("paid") && <p className="mt-1 text-sm text-stone-600">Your free trial has started. Log in with the email and password you just chose.</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{MESSAGES[error] ?? MESSAGES.wrong}</p>}
      <form action={logIn} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className={authLabel} htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={authInput} />
        <label className={authLabel} htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className={authInput} />
        <button type="submit" data-pending-text="Logging in…" className={authButton}>
          Log in
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href={`/login/forgot?next=${encodeURIComponent(next)}`} className="text-stone-700 underline underline-offset-4">
          Forgot your password, or never set one?
        </Link>
      </p>
    </AuthCard>
  );
}
