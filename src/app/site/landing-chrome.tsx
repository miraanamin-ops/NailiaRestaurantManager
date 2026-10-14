import { site } from "@/content/site";
import { CompanyDetails, CtaButton } from "./_components/bits";
import { Wordmark } from "./_components/wordmark";
import { CONTACT_EMAIL, sitePath } from "./frame";

// The landing page's header and footer (dark). The privacy and terms pages use the
// light SiteFrame in frame.tsx, with the same footer details.

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href={sitePath("")} aria-label="DinerAI home">
          <Wordmark />
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-7 text-[14px] text-fog md:flex">
          {site.nav.map((n) => (
            <a key={n.href} href={n.href} className="transition hover:text-mist">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <a href="/login" className="text-[14px] text-fog transition hover:text-mist">
            {site.login}
          </a>
          <span className="hidden sm:block">
            <CtaButton className="px-5 py-2.5 text-[14px]">{site.cta}</CtaButton>
          </span>
        </div>
      </div>
    </header>
  );
}

export function LandingFooter() {
  const f = site.footer;
  return (
    <footer className="border-t border-ink-800 bg-ink-950">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]">
        <div>
          <Wordmark />
          <CompanyDetails className="mt-4 text-fog" />
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-fog md:justify-end">
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-mist">
            {f.contact}: {CONTACT_EMAIL}
          </a>
          <a href={sitePath("privacy")} className="hover:text-mist">
            {f.privacy}
          </a>
          <a href={sitePath("terms")} className="hover:text-mist">
            {f.terms}
          </a>
          <a href="/login" className="hover:text-mist">
            {site.login}
          </a>
        </nav>
      </div>
    </footer>
  );
}

