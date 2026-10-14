import { site } from "@/content/site";

// Small shared pieces of the landing page.

// Marks a made-up number as an example (every illustrative figure carries one).
export function ExampleTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded border border-ember/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ember">{children}</span>
  );
}

// The small monospace label above each section title.
export function Eyebrow({ children, n }: { children: React.ReactNode; n?: string }) {
  return (
    <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
      {n && <span className="text-fog">{n}</span>}
      {children}
    </p>
  );
}

export function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-4 max-w-3xl text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-mist sm:text-5xl">
      {children}
    </h2>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The main call to action. A plain link: /start is on the app domain, and
// dinerai.co.uk/start redirects there (src/lib/hosts.ts).
export function CtaButton({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <a
      href="/start"
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-signal px-7 py-4 text-[16px] font-semibold text-ink-950 transition hover:bg-[#d6f86a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal ${className}`}
    >
      {children}
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

// Company name, number and registered office. Placeholders until the company
// details are filled in (src/content/site.ts, footer).
export function CompanyDetails({ className = "" }: { className?: string }) {
  const f = site.footer;
  return (
    <address className={`space-y-0.5 font-mono text-[12px] not-italic leading-relaxed ${className}`}>
      <p>
        © {f.company}
      </p>
      <p>{f.companyNumber}</p>
      <p>{f.office}</p>
    </address>
  );
}
