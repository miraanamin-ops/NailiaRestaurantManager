"use client";
import { useState } from "react";

// Copies a short text (the sandbox join phrase, a link code) with one tap.
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
      className="min-h-11 shrink-0 rounded-full bg-stone-900 px-4 text-sm font-semibold text-white"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
