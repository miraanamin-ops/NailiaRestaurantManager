"use client";

// On every skippable step: always there, never pushy. Skipping is fine; Dina
// says what it would have unlocked and it becomes a setup gap to come back to.
export function SkipButton({ onSkip, disabled = false }: { onSkip: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onSkip} disabled={disabled} className="min-h-11 rounded-full px-4 text-[14px] text-fog underline-offset-4 hover:text-mist hover:underline disabled:opacity-40">
      Skip for now
    </button>
  );
}
