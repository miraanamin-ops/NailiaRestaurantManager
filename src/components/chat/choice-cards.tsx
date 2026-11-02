"use client";
import type { ChoiceCard, Quote } from "./types";

// Cards to pick one from (e.g. four ways to reply to the same review). One tap picks.
// quote: the review they answer, shown first (a real one, or the typical one we use).
export function ChoiceCards({
  cards,
  quote,
  onPick,
  disabled = false,
  chosenId,
}: {
  cards: ChoiceCard[];
  quote?: Quote;
  onPick: (c: ChoiceCard) => void;
  disabled?: boolean;
  chosenId?: string;
}) {
  return (
    <div className="space-y-3">
      {quote && (
        <figure className="rounded-2xl border border-ink-700 bg-ink-950 p-4">
          <figcaption className="flex items-center justify-between gap-2 text-[13px] text-fog">
            <span className="font-semibold text-mist">{quote.author}</span>
            <span aria-label={`${quote.rating} out of 5 stars`}>
              {"★".repeat(quote.rating)}
              <span className="text-ink-700">{"★".repeat(5 - quote.rating)}</span>
            </span>
          </figcaption>
          <blockquote className="mt-2 text-[15px] leading-relaxed text-mist">“{quote.text}”</blockquote>
          {!quote.real && <p className="mt-2 text-[12px] text-fog">A typical review, to set your tone.</p>}
        </figure>
      )}
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
    </div>
  );
}
