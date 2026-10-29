"use client";
import { useState } from "react";
import type { ProgressData, ProgressStep } from "./types";

// "Setup 2 of 6": tap it to see every step; a skipped or half-done step can be
// picked to do it now. On a laptop the list sits open in the sidebar instead.

const MARK: Record<ProgressStep["status"], string> = {
  done: "✓",
  partial: "◐",
  skipped: "↷",
  waiting: "…",
  in_progress: "●",
  not_started: "○",
};
const STATUS_WORDS: Record<ProgressStep["status"], string> = {
  done: "Done",
  partial: "Half done",
  skipped: "Skipped",
  waiting: "Waiting",
  in_progress: "Now",
  not_started: "To do",
};
export const canJump = (s: ProgressStep) => s.status === "skipped" || s.status === "partial";

export function ProgressBar({
  progress,
  onJump,
  variant = "compact",
  defaultOpen = false,
}: {
  progress: ProgressData;
  onJump?: (key: string) => void;
  variant?: "compact" | "sidebar";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = progress.steps.filter((s) => s.status === "done").length;
  const pct = Math.round((done / Math.max(1, progress.total)) * 100);
  const label = `Setup ${progress.position} of ${progress.total}`;
  const bar = (
    <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-ink-700">
      <div className="h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
    </div>
  );
  const list = (
    <ol className="space-y-1">
      {progress.steps.map((s) => {
        const row = (
          <>
            <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] ${s.status === "done" ? "bg-signal text-ink-950" : s.status === "in_progress" ? "border border-signal text-signal" : "border border-ink-700 text-fog"}`}>
              {MARK[s.status]}
            </span>
            <span className="flex-1 text-left text-[15px] text-mist">{s.title}</span>
            <span className={`text-[12px] ${canJump(s) ? "text-signal" : "text-fog"}`}>{canJump(s) && onJump ? "Do it now" : STATUS_WORDS[s.status]}</span>
          </>
        );
        return (
          <li key={s.key}>
            {canJump(s) && onJump ? (
              <button type="button" onClick={() => (setOpen(false), onJump(s.key))} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 hover:bg-ink-800">
                {row}
              </button>
            ) : (
              <div className="flex min-h-12 items-center gap-3 px-2" aria-current={s.status === "in_progress" ? "step" : undefined}>
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );

  if (variant === "sidebar") {
    return (
      <nav aria-label="Setup steps" className="space-y-4">
        <div className="space-y-2">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-fog">{label}</p>
          {bar}
        </div>
        {list}
      </nav>
    );
  }
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="block min-h-11 w-full space-y-1.5 py-1 text-left">
        <span className="flex items-center justify-between text-[13px] text-fog">
          <span>{label}</span>
          <span className="text-signal">{open ? "Hide steps" : "All steps"}</span>
        </span>
        {bar}
      </button>
      {open && <div className="mt-2 rounded-2xl border border-ink-700 bg-ink-900 p-2">{list}</div>}
    </div>
  );
}
