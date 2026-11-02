"use client";
import { useState } from "react";

// Where the owner types. Enter sends (Shift+Enter for a new line); the box grows
// a little; it's 16px text so phones don't zoom in. While Dina answers, it waits.
export function Composer({ onSend, disabled = false, placeholder = "Type a message" }: { onSend: (text: string) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor="dina-composer">
        Message Dina
      </label>
      <textarea
        id="dina-composer"
        value={text}
        rows={1}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className="max-h-36 min-h-12 flex-1 resize-none rounded-3xl border border-ink-700 bg-ink-900 px-4 py-3 text-[16px] text-mist placeholder:text-fog/70 [field-sizing:content]"
      />
      <button
        type="submit"
        aria-label="Send"
        disabled={disabled || !text.trim()}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-signal text-ink-950 transition hover:bg-[#d6f86a] disabled:bg-ink-800 disabled:text-fog"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M5 12h13m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
