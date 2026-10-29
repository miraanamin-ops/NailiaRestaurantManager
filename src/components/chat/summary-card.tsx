import { card } from "./styles";
import type { SummaryData } from "./types";

// The end of setup: everything Dina has, each with a change link; what's still
// locked and what it would unlock; and what happens next.
export function SummaryCard({ summary }: { summary: SummaryData }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="border-b border-ink-700 p-4">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fog">Your setup</p>
        <p className="mt-1 text-2xl font-semibold text-mist">
          {summary.done} of {summary.total} done
        </p>
      </div>
      <ul className="divide-y divide-ink-700">
        {summary.items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 px-4 py-3">
            <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${i.status === "done" ? "bg-signal text-ink-950" : "border border-ink-700 text-fog"}`}>
              {i.status === "done" ? "✓" : i.status === "partial" ? "◐" : "↷"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-mist">{i.title}</span>
              <span className="block break-words text-[14px] text-fog">{i.detail}</span>
            </span>
            {i.editHref && (
              <a href={i.editHref} className="flex min-h-11 shrink-0 items-center px-1 text-[14px] text-signal underline underline-offset-4">
                Change
              </a>
            )}
          </li>
        ))}
      </ul>
      {summary.locked.length > 0 && (
        <div className="border-t border-ink-700 p-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fog">Still to unlock</p>
          <ul className="mt-2 space-y-2">
            {summary.locked.map((l) => (
              <li key={l.key} className="text-[14px] text-fog">
                <span className="font-medium text-mist">{l.title}:</span> {l.unlock}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.next.length > 0 && (
        <div className="border-t border-ink-700 bg-signal/5 p-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-signal">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-mist">
            {summary.next.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
