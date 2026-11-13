import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { setPassword } from "@/app/login/actions";
import { AuthCard, authButton, authInput, authLabel } from "@/app/login/ui";
import { requireAccount } from "@/lib/auth";
import { PASSWORD_MIN } from "@/lib/auth-rules";

export const metadata: Metadata = { title: "Your password", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  short: `Please use at least ${PASSWORD_MIN} characters.`,
  long: "That's too long. Please use 72 characters or fewer.",
  different: "The two passwords don't match.",
  same: "That's your current password. Please choose a new one.",
  weak: "That password is too easy to guess. Please choose another.",
  failed: "Couldn't save the password. Please try again.",
};

// Choose a new password: after the "Forgot your password?" link, or from the account menu.
export default function PasswordPage({ searchParams }: PageProps<"/account/password">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Password searchParams={searchParams} />
    </Suspense>
  );
}

async function Password({ searchParams }: Pick<PageProps<"/account/password">, "searchParams">) {
  await connection();
  const owner = await requireAccount("/account/password");
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const error = one("error");

  return (
    <AuthCard title={one("reset") ? "Choose your password" : "Change your password"}>
      {one("saved") ? (
        <>
          <p className="mt-3 text-sm text-stone-700">✅ Password saved. Next time, log in with {owner.email} and this password.</p>
          <Link href="/" className={`${authButton} mt-4 block text-center`}>
            Go to DinerAI
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-600">For {owner.email}. At least {PASSWORD_MIN} characters.</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{MESSAGES[error] ?? MESSAGES.failed}</p>}
          <form action={setPassword} className="mt-4 space-y-3">
            <input type="text" name="username" value={owner.email} autoComplete="username" readOnly hidden />
            <label className={authLabel} htmlFor="password">
              New password
            </label>
            <input id="password" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className={authInput} />
            <label className={authLabel} htmlFor="again">
              Type it again
            </label>
            <input id="again" name="again" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className={authInput} />
            <button type="submit" data-pending-text="Saving…" className={authButton}>
              Save password
            </button>
          </form>
        </>
      )}
    </AuthCard>
  );
}
