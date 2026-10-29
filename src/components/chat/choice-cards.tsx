"use client";
import type { ChoiceCard } from "./types";

// Cards to pick one from (e.g. four ways to reply to the same review). One tap picks.
export function ChoiceCards({ cards, onPick, disabled = false, chosenId }: { cards: ChoiceCard[]; onPick: (c: ChoiceCard) => void; disabled?: boolean; chosenId?: string }) {
  return (
    <div role="radiogroup" aria-label="Choices" className="grid gap-3 sm:grid-cols-2">
      {cards.map((c) => {
        const chosen = chosenId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            onClick={() => onPick(c)}
            className={`min-h-12 rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
              chosen ? "border-signal bg-signal/10" : "border-ink-700 bg-ink-900 hover:border-signal/60"
            } ${disabled && !chosen ? "opacity-50" : ""}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold text-mist">{c.title}</span>
              <span aria-hidden className={`h-5 w-5 shrink-0 rounded-full border-2 ${chosen ? "border-signal bg-signal" : "border-ink-700"}`} />
            </span>
            <span className="mt-2 block whitespace-pre-line text-[14px] leading-relaxed text-fog">{c.body}</span>
          </button>
        );
      })}
    </div>
  );
}
