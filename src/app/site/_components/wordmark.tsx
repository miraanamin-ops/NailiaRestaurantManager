// The DinerAI wordmark: a tick in a rounded square (the one-tap approval), then the
// name with "AI" in the signal colour. Drawn in code so it stays sharp at any size.
export function Wordmark({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  const ink = tone === "dark" ? "text-mist" : "text-ink-950";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="26" height="26" rx="7" fill="#c8f03c" />
        <path d="M8 14.5l4 4 8-9" fill="none" stroke="#0b0c0a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-[19px] font-semibold tracking-[-0.02em] ${ink}`}>
        Diner<span className={tone === "dark" ? "text-signal" : "text-ink-950"}>AI</span>
      </span>
    </span>
  );
}
