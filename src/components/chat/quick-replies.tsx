"use client";
import { secondary } from "./styles";
import type { ChatOption } from "./types";

// Tap-to-answer buttons under one of Dina's messages. Once answered they stay as a
// record of the choice (the picked one highlighted) and can't be pressed again.
export function QuickReplies({ options, onPick, disabled = false, chosenId }: { options: ChatOption[]; onPick: (o: ChatOption) => void; disabled?: boolean; chosenId?: string }) {
  return (
    <div role="group" aria-label="Quick replies" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          aria-pressed={chosenId === o.id}
          onClick={() => onPick(o)}
          className={`${secondary} ${chosenId === o.id ? "!border-signal !bg-signal/15 !opacity-100" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
