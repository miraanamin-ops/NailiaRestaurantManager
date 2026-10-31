"use client";
import { useState } from "react";
import { card, primary, secondary } from "./styles";
import type { ChatOption, HowToStep } from "./types";

// Cards for steps the owner does somewhere else (adding DinerAI on Google): the
// numbered steps with screenshots, a message to forward, a button to a page.
// What's in them comes from code (lib/onboarding/dina/google-content.ts), never Dina's words.

// Copies a short text with one tap (an email address, a message to forward).
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Some browsers block the clipboard: the text is on screen to copy by hand.
        }
      }}
      className={`${secondary} shrink-0 px-4`}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export function StepsCard({
  title,
  steps,
  note,
  video,
  actions,
  onAction,
  disabled = false,
  chosenId,
}: {
  title: string;
  steps: HowToStep[];
  note: string;
  video: string | null;
  actions: ChatOption[];
  onAction: (o: ChatOption) => void;
  disabled?: boolean;
  chosenId?: string;
}) {
  return (
    <div className={`${card} overflow-hidden`}>
      <p className="border-b border-ink-700 px-4 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-fog">{title}</p>
      {video && <video src={video} controls playsInline className="w-full border-b border-ink-700 bg-ink-950" aria-label="Video of the steps" />}
      <ol className="divide-y divide-ink-800">
        {steps.map((s) => (
          <li key={s.n} className="space-y-3 p-4">
            <p className="text-[15px] leading-relaxed text-mist">
              <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-signal text-[14px] font-bold text-ink-950">{s.n}</span>
              {s.text}
            </p>
            {s.copy && (
              <div className="flex items-center gap-2 rounded-xl bg-ink-950 p-2 pl-3">
                <code className="min-w-0 flex-1 break-all text-[15px] text-mist">{s.copy}</code>
                <CopyButton text={s.copy} />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- plain screenshots from /public, swapped by the builder */}
            <img src={s.image} alt={`Step ${s.n}: ${s.text}`} loading="lazy" className="w-full rounded-xl border border-ink-700" />
          </li>
        ))}
      </ol>
      <p className="border-t border-ink-700 px-4 py-3 text-[14px] font-semibold text-mist">{note}</p>
      <div className="flex flex-wrap gap-2 border-t border-ink-700 p-4">
        {actions.map((a, i) => (
          <button
            key={a.id}
            type="button"
            disabled={disabled}
            aria-pressed={chosenId === a.id}
            onClick={() => onAction(a)}
            className={`${i === 0 ? primary : secondary} ${chosenId === a.id ? "ring-2 ring-signal" : ""}`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ForwardCard({ intro, text }: { intro: string; text: string }) {
  return (
    <div className={`${card} space-y-3 p-4`}>
      <p className="text-[14px] text-fog">{intro}</p>
      <p className="whitespace-pre-line rounded-xl bg-ink-950 p-3 text-[15px] leading-relaxed text-mist">{text}</p>
      <CopyButton text={text} label="Copy the message" />
    </div>
  );
}

export function LinkCard({ label, href, hint }: { label: string; href: string; hint: string | null }) {
  return (
    <div className={`${card} space-y-3 p-4`}>
      {hint && <p className="text-[14px] text-fog">{hint}</p>}
      <a href={href} className={`${primary} inline-flex items-center justify-center`}>
        {label}
      </a>
    </div>
  );
}
