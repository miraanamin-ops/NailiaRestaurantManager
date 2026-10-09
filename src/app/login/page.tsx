import { Suspense } from "react";
import type { Metadata } from "next";
import { sendLoginLink } from "./actions";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  email: "That doesn't look like an email address.",
  wait: "Too many login emails just now. Please wait a minute and try again.",
  send: "Couldn't send the login email. Please try again.",
  expired: "That login link has expired or was already used. Ask for a new one below.",
};

// Owner login: enter your email, tap the link we send. No password.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
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
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 text-stone-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70">
        <h1 className="text-xl font-bold">Log in</h1>
        {one("sent") ? (
          <p className="mt-3 text-sm text-stone-700">
            📧 If that email is registered, a login link is on its way. Open it on this device to log in. It works once and expires after an hour.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-stone-600">
              {one("out") ? "You're logged out. " : ""}We&apos;ll email you a link to log in. No password needed.
            </p>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{MESSAGES[error] ?? MESSAGES.send}</p>}
            <form action={sendLoginLink} className="mt-4 space-y-3">
              <input type="hidden" name="next" value={next} />
              <label className="block text-sm font-medium text-stone-700" htmlFor="email">
                Your email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base"
              />
              <button type="submit" className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white">
                Email me a login link
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
