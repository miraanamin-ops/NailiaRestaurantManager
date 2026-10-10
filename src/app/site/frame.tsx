import Link from "next/link";
import { LIVE_APP_URL } from "@/lib/hosts";

// The DinerAI holding site (dinerai.co.uk): a calm, mobile-first frame shared by
// the home page, the privacy notice and the terms. Served at "/", "/privacy" and
// "/terms" on dinerai.co.uk (src/proxy.ts rewrites them to /site/...).

export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@dinerai.co.uk";
export const COMPANY = "DinerAI";
const appUrl = () => (process.env.APP_URL || LIVE_APP_URL).replace(/\/$/, "");

// On dinerai.co.uk the pages are "/", "/privacy" and "/terms"; on the app domain they're under /site.
export const sitePath = (page: "" | "privacy" | "terms") => (page ? `/${page}` : "/");

export function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#fbf8f3] font-sans text-stone-900">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5">
        <Link href={sitePath("")} className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#c2410c] text-sm text-white">
            D
          </span>
          DinerAI
        </Link>
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm font-medium text-stone-600 hover:text-stone-900">
          Contact
        </a>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 pb-12">{children}</main>
      <footer className="border-t border-stone-200">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 py-6 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {COMPANY} ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
          </p>
          <nav className="flex gap-4">
            <Link href={sitePath("privacy")} className="underline">
              Privacy
            </Link>
            <Link href={sitePath("terms")} className="underline">
              Terms
            </Link>
            <a href={`${appUrl()}/login`} className="underline">
              Owner login
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export const startUrl = () => `${appUrl()}/start`;
