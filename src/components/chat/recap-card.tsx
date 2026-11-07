"use client";
import { card, primary } from "./styles";
import type { RecapData } from "./types";

// The end of a chapter (owner's plan, 7 Nov 2026): everything it saved, from the
// database, each line with Change; "Looks right" confirms the chapter and moves on.
export function RecapCard({ recap, onAnswer, disabled = false }: { recap: RecapData; onAnswer: (choiceId: string, label: string) => void; disabled?: boolean }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <p className="border-b border-ink-700 px-4 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-fog">{recap.title}</p>
      <ul className="divide-y divide-ink-800">
        {recap.rows.map((r) => (
          <li key={r.q} className="flex items-start gap-3 px-4 py-3">
            <span aria-hidden className={`mt-0.5 text-[14px] ${r.status === "skipped" ? "text-fog" : "text-signal"}`}>
              {r.status === "skipped" ? "↷" : "✓"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-fog">{r.label}</p>
              <p className="flex flex-wrap items-center gap-2 text-[15px] text-mist">
                {r.swatches?.map((c) => <span key={c} aria-hidden className="h-4 w-4 rounded-full ring-1 ring-ink-700" style={{ background: c }} />)}
                <span className="whitespace-pre-line">{r.value}</span>
              </p>
            </div>
            {!disabled && (
              <button type="button" onClick={() => onAnswer(`change:${r.q}`, `Change: ${r.label}`)} className="min-h-11 shrink-0 rounded-full px-3 text-[14px] font-medium text-signal hover:underline">
                Change
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="border-t border-ink-700 p-4">
          <button type="button" onClick={() => onAnswer("recap_ok", "Looks right")} className={`${primary} w-full`}>
            Looks right{recap.next ? `, on to ${recap.next}` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
