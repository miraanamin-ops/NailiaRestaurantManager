import type { Metadata } from "next";
import { fill, site } from "@/content/site";
import { PRICE_GBP, trialDays } from "@/lib/billing/config";
import { Check, CtaButton, ExampleTag, Eyebrow, SectionTitle } from "./_components/bits";
import { CountUp } from "./_components/count-up";
import { Gate } from "./_components/gate";
import { HeroPhone } from "./_components/hero-phone";
import { ReportPreview } from "./_components/report-preview";
import { CONTACT_EMAIL, SITE_URL } from "./frame";
import { LandingFooter, LandingHeader } from "./landing-chrome";
import "./landing.css";

// dinerai.co.uk: the public landing page. Every word comes from src/content/site.ts.
// Served at "/" on dinerai.co.uk (src/proxy.ts rewrites it to /site); on the app
// domain and previews it's at /site.

const values = { days: trialDays(), price: PRICE_GBP };
const t = (text: string) => fill(text, values);

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: site.meta.title },
  description: t(site.meta.description),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "DinerAI",
    locale: "en_GB",
    title: site.meta.title,
    description: t(site.meta.description),
  },
  twitter: { card: "summary_large_image", title: site.meta.title, description: t(site.meta.description) },
};

export default function SiteHome() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DinerAI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "WhatsApp",
    description: t(site.meta.description),
    offers: { "@type": "Offer", price: String(PRICE_GBP), priceCurrency: "GBP" },
  };

  return (
    <div className="dai-site min-h-dvh bg-ink-950 font-sans text-mist antialiased selection:bg-signal selection:text-ink-950">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-2 focus:text-ink-950">
        Skip to content
      </a>
      <LandingHeader />

      <main id="main">
        <Hero />
        <Problem />
        <How />
        <Outcomes />
        <Safety />
        <Report />
        <Pricing />
        <Faqs />
        <Final />
      </main>

      <LandingFooter />
    </div>
  );
}

const wrap = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const section = "relative border-t border-ink-800 py-20 sm:py-28";

function Hero() {
  const h = site.hero;
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden pb-20 pt-10 sm:pb-28 sm:pt-16">
      <div aria-hidden className="dai-grid absolute inset-0">
        <div className="dai-scan" />
      </div>
      <div className={`${wrap} relative grid items-center gap-14 lg:grid-cols-[1.15fr_1fr]`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/80 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
            <span className="dai-pulse h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
            {h.eyebrow}
          </p>
          <h1 id="hero-title" className="mt-6 text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-[68px]">
            {h.headline[0]} <span className="text-signal">{h.headline[1]}</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-fog sm:text-lg">{h.subline}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <CtaButton>{site.cta}</CtaButton>
            <a href="#how" className="inline-flex items-center justify-center rounded-full border border-ink-700 px-7 py-4 text-[16px] font-medium text-mist transition hover:border-fog">
              {h.secondary}
            </a>
          </div>
          <p className="mt-4 font-mono text-[12px] text-fog">{t(h.note)}</p>
        </div>
        <HeroPhone phone={site.phone} label={h.phoneLabel} />
      </div>
    </section>
  );
}

function Problem() {
  const p = site.problem;
  // The day as a bar from 06:00 to 02:00; each block runs until the next one starts.
  const START = 6;
  const END = 26;
  const hours = (time: string) => Number(time.slice(0, 2)) + Number(time.slice(3)) / 60;
  const pos = (h: number) => ((h - START) / (END - START)) * 100;
  const blocks = p.day.map((d, i) => ({ ...d, from: hours(d.time), to: i + 1 < p.day.length ? hours(p.day[i + 1].time) : 24 }));

  return (
    <section aria-labelledby="problem-title" className={section}>
      <div className={wrap}>
        <Eyebrow n="01">{p.eyebrow}</Eyebrow>
        <SectionTitle id="problem-title">{p.title}</SectionTitle>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-fog">{p.body}</p>

        <figure className="mt-12 rounded-3xl border border-ink-700 bg-ink-900 p-4 sm:p-6">
          <figcaption className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
            {p.dayLabel}
            <span>06:00 → 02:00</span>
          </figcaption>
          <div aria-hidden className="relative mt-4 h-14 overflow-hidden rounded-xl bg-ink-950">
            {blocks.map((b) => (
              <div
                key={b.label}
                className={`absolute inset-y-1.5 rounded-md ${b.kind === "service" ? "bg-mist/85" : "bg-ink-700"}`}
                style={{ left: `${pos(b.from)}%`, width: `calc(${pos(b.to) - pos(b.from)}% - 3px)` }}
              />
            ))}
            <div
              className="absolute inset-y-1.5 rounded-md border border-ember/70"
              style={{
                left: `${pos(24)}%`,
                right: 6,
                backgroundImage: "repeating-linear-gradient(135deg, rgb(255 122 61 / 0.35) 0 6px, transparent 6px 12px)",
              }}
            />
            <div className="absolute inset-y-0 w-px bg-ember" style={{ left: `${pos(24)}%` }} />
          </div>
          <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-6">
            {p.day.map((d) => (
              <li key={d.label} className="flex items-baseline gap-2 text-[13px]">
                <span className="font-mono text-[11px] text-fog">{d.time}</span>
                <span className={d.kind === "service" ? "text-mist" : "text-fog"}>{d.label}</span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 text-[13px]">
              <span className="font-mono text-[11px] text-ember">00:00</span>
              <span className="text-ember">{p.pileLabel}</span>
            </li>
          </ol>

          <div className="mt-6 border-t border-ink-800 pt-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ember">{p.pileLabel}</p>
              <ExampleTag>{p.pileExample}</ExampleTag>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {p.pile.map((item, i) => (
                <li
                  key={item}
                  className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-1.5 text-[14px] text-mist"
                  style={{ transform: `rotate(${[-1.5, 1, -0.5, 1.5, -1][i % 5]}deg)` }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </figure>
      </div>
    </section>
  );
}

function How() {
  const h = site.how;
  return (
    <section id="how" aria-labelledby="how-title" className={`${section} scroll-mt-16`}>
      <div className={wrap}>
        <Eyebrow n="02">{h.eyebrow}</Eyebrow>
        <SectionTitle id="how-title">{h.title}</SectionTitle>

        <div className="relative mt-12">
          <div
            aria-hidden
            className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-signal/60 via-ink-700 to-signal/60 lg:bottom-auto lg:left-6 lg:right-6 lg:top-[19px] lg:h-px lg:w-auto lg:bg-gradient-to-r"
          />
          <ol className="relative grid gap-4 lg:grid-cols-3">
            {h.steps.map((s, i) => (
              <li key={s.title} className="relative pl-12 lg:pl-0 lg:pt-12">
                <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border border-signal/60 bg-ink-950 font-mono text-sm text-signal">
                  {i + 1}
                </span>
                <div className="h-full rounded-3xl border border-ink-700 bg-ink-900 p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">{s.tag}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-fog">{s.body}</p>
                  <div aria-hidden className="mt-5 rounded-2xl bg-ink-950 p-3">
                    {i === 0 && (
                      <ul className="space-y-1.5 font-mono text-[12px]">
                        {s.ui.map((u) => (
                          <li key={u} className="flex items-center gap-2 text-mist/90">
                            <Check className="text-signal" />
                            {u}
                          </li>
                        ))}
                      </ul>
                    )}
                    {i === 1 && (
                      <div className="relative h-[124px]">
                        {s.ui.map((u, j) => (
                          <div
                            key={u}
                            className="absolute inset-x-0 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2 text-[13px]"
                            style={{ top: j * 26, transform: `scale(${1 - (s.ui.length - 1 - j) * 0.03})`, zIndex: j }}
                          >
                            <span className="font-mono text-[10px] uppercase tracking-wider text-fog">Draft</span> <span className="text-mist">{u}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {i === 2 && (
                      <div className="grid gap-1.5">
                        {s.ui.map((u, j) => (
                          <span
                            key={u}
                            className={`rounded-xl py-2 text-center text-[13px] font-medium ${j === 0 ? "bg-signal text-ink-950" : "bg-ink-800 text-mist/80"}`}
                          >
                            {u}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  const o = site.outcomes;
  return (
    <section aria-labelledby="outcomes-title" className={section}>
      <div className={wrap}>
        <Eyebrow n="03">{o.eyebrow}</Eyebrow>
        <SectionTitle id="outcomes-title">{o.title}</SectionTitle>

        <div className="mt-10">
          <CountUp items={o.counter} label={o.counterLabel} example={o.example} />
        </div>

        <ul className="mt-4 divide-y divide-ink-800 rounded-3xl border border-ink-700 bg-ink-900">
          {o.items.map((item) => (
            <li key={item.title} className="grid gap-4 p-5 sm:p-6 md:grid-cols-[1fr_260px] md:items-center md:gap-10">
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{item.title}</h3>
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fog">{item.body}</p>
              </div>
              <div className="rounded-2xl border border-ink-700 bg-ink-950 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10.5px] uppercase tracking-wider text-fog">{item.readout.label}</p>
                  <ExampleTag>{o.example}</ExampleTag>
                </div>
                <p className="mt-2 font-mono text-2xl tabular-nums text-signal">{item.readout.value}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-5 flex flex-wrap items-center gap-2 text-[14px] text-fog">
          <span className="rounded-full border border-ink-700 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist">{o.soonLabel}</span>
          {o.soon.join(" · ")}
        </p>
      </div>
    </section>
  );
}

function Safety() {
  const s = site.safety;
  return (
    <section id="safety" aria-labelledby="safety-title" className={`${section} scroll-mt-16`}>
      <div className={wrap}>
        <Eyebrow n="04">{s.eyebrow}</Eyebrow>
        <SectionTitle id="safety-title">{s.title}</SectionTitle>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-fog">{s.body}</p>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <Gate cards={s.cards} checks={s.gateChecks} label={s.gateLabel} />
          <ul className="grid gap-2">
            {s.controls.map((c) => (
              <li key={c.key} className="flex items-start gap-4 rounded-2xl border border-ink-800 px-4 py-3">
                <span className="mt-0.5 min-w-[92px] rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-center font-mono text-[12px] text-signal">{c.key}</span>
                <span className="text-[15px] leading-relaxed text-mist/90">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-8 max-w-3xl text-[14px] leading-relaxed text-fog">{s.footnote}</p>
      </div>
    </section>
  );
}

function Report() {
  const r = site.report;
  return (
    <section aria-labelledby="report-title" className={section}>
      <div className={`${wrap} grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-center`}>
        <div>
          <Eyebrow n="05">{r.eyebrow}</Eyebrow>
          <SectionTitle id="report-title">{r.title}</SectionTitle>
          <p className="mt-5 text-[17px] leading-relaxed text-fog">{r.body}</p>
        </div>
        <ReportPreview report={r} example={site.outcomes.example} />
      </div>
    </section>
  );
}

function Pricing() {
  const p = site.pricing;
  const lines = site.outcomes.items.map((i) => i.title);
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={`${section} scroll-mt-16`}>
      <div className={`${wrap} grid gap-12 lg:grid-cols-2 lg:items-center`}>
        <div>
          <Eyebrow n="06">{p.eyebrow}</Eyebrow>
          <SectionTitle id="pricing-title">{p.title}</SectionTitle>
          <ul className="mt-6 space-y-3">
            {p.points.map((point) => (
              <li key={point} className="flex gap-3 text-[16px] leading-relaxed text-mist/90">
                <Check className="mt-1.5 text-signal" />
                {t(point)}
              </li>
            ))}
          </ul>
        </div>

        {/* The price as a till receipt. */}
        <div className="mx-auto w-full max-w-sm rotate-[0.6deg] rounded-sm bg-mist px-6 pb-6 pt-7 font-mono text-[13px] text-ink-950 shadow-[0_30px_80px_-30px_rgb(200_240_60_/_0.3)]">
          <p className="text-center text-[15px] font-semibold tracking-[0.2em]">DINERAI</p>
          <p className="text-center text-[11px] text-ink-950/65">ONE PLAN · ONE RESTAURANT</p>
          <div className="my-4 border-t border-dashed border-ink-950/30" />
          <ul className="space-y-1.5">
            {lines.map((l) => (
              <li key={l} className="flex justify-between gap-3">
                <span>{l}</span>
                <span className="text-ink-950/65">incl.</span>
              </li>
            ))}
          </ul>
          <div className="my-4 border-t border-dashed border-ink-950/30" />
          <p className="flex items-end justify-between">
            <span className="text-[11px] uppercase">Monthly</span>
            <span>
              <span className="text-4xl font-semibold tracking-tight">{t(p.price)}</span>
              <span className="text-ink-950/65"> {p.per}</span>
            </span>
          </p>
          <p className="mt-1 flex justify-between text-[12px]">
            <span>{t(p.trial).toUpperCase()}</span>
            <span>£0.00</span>
          </p>
          <p className="mt-1 flex justify-between text-[12px]">
            <span>SETUP FEE</span>
            <span>£0.00</span>
          </p>
          <div className="my-4 border-t border-dashed border-ink-950/30" />
          <CtaButton className="w-full !bg-ink-950 font-sans !text-mist hover:!bg-ink-800">{site.cta}</CtaButton>
          <p className="mt-3 text-center text-[11px] text-ink-950/65">{p.fine}</p>
        </div>
      </div>
    </section>
  );
}

function Faqs() {
  const f = site.faqs;
  return (
    <section id="faqs" aria-labelledby="faqs-title" className={`${section} scroll-mt-16`}>
      <div className={`${wrap} grid gap-10 lg:grid-cols-[0.7fr_1.3fr]`}>
        <div>
          <Eyebrow n="07">{f.eyebrow}</Eyebrow>
          <SectionTitle id="faqs-title">{f.title}</SectionTitle>
          <p className="mt-5 text-[15px] text-fog">
            Anything else?{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-mist underline decoration-signal underline-offset-4">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
        <div className="divide-y divide-ink-800 border-y border-ink-800">
          {f.items.map((item) => (
            <details key={item.q} className="dai-faq">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-medium text-mist">
                {item.q}
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className="shrink-0 text-signal">
                  <path d="M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path className="dai-plus-v" d="M8 2v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="pb-5 pr-8 text-[15px] leading-relaxed text-fog">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Final() {
  const f = site.final;
  return (
    <section aria-labelledby="final-title" className="relative overflow-hidden border-t border-ink-800 py-24 sm:py-32">
      <div aria-hidden className="dai-grid absolute inset-0" />
      <div className={`${wrap} relative text-center`}>
        <h2 id="final-title" className="text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
          {f.title}
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[17px] text-fog">{t(f.body)}</p>
        <div className="mt-8 flex justify-center">
          <CtaButton>{site.cta}</CtaButton>
        </div>
      </div>
    </section>
  );
}
