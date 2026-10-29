import { DinaAvatar } from "./message-bubble";

// While Dina thinks: three dots in a bubble, announced to screen readers.
export function TypingIndicator({ label = "Dina is typing" }: { label?: string }) {
  return (
    <div className="flex items-end gap-2" role="status" aria-live="polite">
      <DinaAvatar />
      <span className="flex h-11 items-center gap-1.5 rounded-2xl rounded-bl-md border border-ink-700 bg-ink-850 px-4">
        <span className="sr-only">{label}</span>
        {[0, 1, 2].map((i) => (
          <span key={i} aria-hidden className="dai-typing-dot h-2 w-2 rounded-full bg-fog" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
    </div>
  );
}
