import Link from "next/link";
import { site } from "@/content/site";
import { CompanyDetails } from "./_components/bits";
import { Wordmark } from "./_components/wordmark";

// The DinerAI public site (dinerai.co.uk). This light frame is shared by the
// privacy notice and the terms; the landing page has its own dark header and
// footer (landing-chrome.tsx). Served at "/", "/privacy" and "/terms" on
// dinerai.co.uk (src/proxy.ts rewrites them to /site/...).

export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@dinerai.co.uk";
export const COMPANY = "DinerAI";
export const SITE_URL = "https://dinerai.co.uk";

// "/", "/privacy" and "/terms" work on dinerai.co.uk; "/privacy" and "/terms" also
// on the app domain and previews (src/lib/hosts.ts), where the landing page is /site.
export const sitePath = (page: "" | "privacy" | "terms") => (page ? `/${page}` : "/");

export function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#fbf9f4] font-sans text-stone-900">
      <header className="bg-ink-950">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
          <Link href={sitePath("")} aria-label="DinerAI home">
            <Wordmark />
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm font-medium text-fog hover:text-mist">
            {site.footer.contact}
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 pb-12">{children}</main>
      <footer className="border-t border-stone-200">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6 text-sm text-stone-600 sm:flex-row sm:items-start sm:justify-between">
          <CompanyDetails />
          <nav className="flex flex-wrap gap-4">
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
            <Link href={sitePath("privacy")} className="underline">
              {site.footer.privacy}
            </Link>
            <Link href={sitePath("terms")} className="underline">
              {site.footer.terms}
            </Link>
            <a href="/login" className="underline">
              Owner login
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
