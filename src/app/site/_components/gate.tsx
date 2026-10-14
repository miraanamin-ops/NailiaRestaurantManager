import { Check } from "./bits";

type Card = { title: string; detail: string; ok: boolean };

// Approval cards sliding through the "checker" gate: three pass with a tick, the
// over-the-cap offer is held back. Pure CSS (landing.css); under reduced motion,
// and for screen readers, a plain list shows the same outcome.
export function Gate({ cards, checks, label }: { cards: readonly Card[]; checks: readonly string[]; label: string }) {
  return (
    <div className="rounded-3xl border border-ink-700 bg-ink-900 p-4 sm:p-6">
      <div aria-hidden className="dai-rm-hide relative h-[132px] overflow-hidden rounded-2xl bg-ink-950 dai-grid">
        {cards.map((c, i) => (
          <div key={c.title} className="dai-lane" data-held={!c.ok} style={{ "--d": `${i * 3.5}s` } as React.CSSProperties}>
            <div className="absolute left-1/2 top-1/2 h-[84px] w-[172px] -translate-x-1/2 -translate-y-1/2">
              <div className="dai-before absolute inset-0 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2.5">
                <p className="truncate text-[13px] font-medium text-mist">{c.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-fog">{c.detail.startsWith("Held") ? "Discount check" : c.detail}</p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fog">Checking…</p>
              </div>
              <div
                className={`dai-after absolute inset-0 rounded-xl border px-3 py-2.5 ${c.ok ? "border-signal/50 bg-[#1b220d]" : "border-ember/60 bg-[#2a170d]"}`}
              >
                <p className="truncate text-[13px] font-medium text-mist">{c.title}</p>
                <p className={`mt-0.5 truncate text-[11.5px] ${c.ok ? "text-fog" : "text-ember"}`}>{c.detail}</p>
                <p className={`mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${c.ok ? "text-signal" : "text-ember"}`}>
                  {c.ok ? (
                    <>
                      <Check /> To your WhatsApp
                    </>
                  ) : (
                    "Held · not sent"
                  )}
                </p>
              </div>
            </div>
          </div>
        ))}
        {/* The gate itself */}
        <div className="pointer-events-none absolute inset-y-3 left-1/2 w-[3px] -translate-x-1/2 overflow-hidden rounded-full bg-signal/15">
          <div className="dai-beam h-full w-full bg-gradient-to-b from-transparent via-signal to-transparent" />
        </div>
        <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded bg-ink-950 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-signal">
          {label}
        </span>
      </div>

      <ul className="dai-sr-reveal space-y-2">
        {cards.map((c) => (
          <li key={c.title} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2 text-sm">
            <span className="text-mist">{c.title}</span>
            <span className={`font-mono text-xs ${c.ok ? "text-signal" : "text-ember"}`}>{c.ok ? "Passed, sent to you" : c.detail}</span>
          </li>
        ))}
      </ul>

      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {checks.map((c, i) => (
          <li key={c} className="rounded-lg border border-ink-700 px-2.5 py-2 font-mono text-[10.5px] uppercase leading-tight tracking-wider text-fog">
            <span className="text-signal">0{i + 1}</span> {c}
          </li>
        ))}
      </ol>
    </div>
  );
}
