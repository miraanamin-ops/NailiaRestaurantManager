"use client";
import { useState } from "react";
import { card, primary, secondary } from "./styles";
import type { QuestionCardData, QuestionOption } from "./types";
import { UploadCard } from "./upload-card";
import { AllergenGrid, initialGrid, type GridValue } from "./allergen-grid";
import { DataTable, initialStaffing, StaffingEditor } from "./staffing-editor";
import type { StaffingAnswer } from "./types";

// One of setup's questions (lib/onboarding/guide/cards.ts). A tap selects (it's
// highlighted); on a decision nothing is saved until Confirm, and the pick can be
// changed freely before that (owner's plan, 7 Nov 2026). A choice that needs
// words ("Choose my own") opens a box. "Skip this question" moves to the next
// question and never skips anything else. Once answered, it stays as a record.

export type QuestionAnswer = { choiceIds: string[]; text?: string; label: string; grid?: GridValue; staffing?: StaffingAnswer };

export function QuestionCard({
  data,
  onAnswer,
  onFiles,
  disabled = false,
  uploadStatus,
}: {
  data: QuestionCardData;
  onAnswer: (a: QuestionAnswer) => void;
  onFiles?: (files: File[]) => void;
  disabled?: boolean;
  uploadStatus?: string;
}) {
  const [picked, setPicked] = useState<string[]>(data.selected ?? []);
  const [text, setText] = useState("");
  const [grid, setGrid] = useState<GridValue>(() => (data.grid ? initialGrid(data.grid) : {}));
  const [staffing, setStaffing] = useState<StaffingAnswer>(() => (data.staffing ? initialStaffing(data.staffing) : {}));
  // The staffing card is changed with its own + and −; its typed choice is for WhatsApp.
  const options = data.staffing ? data.options.filter((o) => o.id !== data.input?.optionId && o.id !== "ok") : data.options;
  // Only words to type (no choices): the box is always there.
  const wordsOnly = Boolean(data.input) && data.options.length === 0;
  const needsWords = data.input && (wordsOnly || picked.includes(data.input.optionId));
  const ready = data.grid || data.staffing ? true : (picked.length > 0 || wordsOnly) && (!needsWords || text.trim().length > 0);
  const labelOf = (ids: string[]) => (data.grid ? "These are right" : needsWords ? text.trim() : ids.map((id) => data.options.find((o) => o.id === id)?.label ?? id).join(", "));

  const tap = (o: QuestionOption) => {
    if (disabled) return;
    const next = data.multi ? (picked.includes(o.id) ? picked.filter((x) => x !== o.id) : [...picked, o.id]) : [o.id];
    setPicked(next);
    // Not a decision, one choice, no words needed: a tap is the answer.
    if (!data.confirm && !data.multi && !(data.input && o.id === data.input.optionId)) onAnswer({ choiceIds: next, label: o.label });
  };
  const confirm = () => {
    if (!ready) return;
    if (data.grid) return onAnswer({ choiceIds: [data.options[0]?.id ?? "grid_ok"], grid, label: labelOf([]) });
    if (data.staffing) return onAnswer({ choiceIds: ["ok"], staffing, label: "Save these numbers" });
    const ids = wordsOnly ? [data.input!.optionId] : picked;
    onAnswer({ choiceIds: ids, ...(needsWords ? { text: text.trim() } : {}), label: labelOf(ids) });
  };

  return (
    <div className="space-y-3">
      {data.image && (
        <div className={`${card} flex items-center justify-center p-4`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored logo, any size */}
          <img src={data.image} alt="Your logo" className="max-h-32 max-w-full object-contain" />
        </div>
      )}
      {data.quote && (
        <figure className="rounded-2xl border border-ink-700 bg-ink-950 p-4">
          <figcaption className="flex items-center justify-between gap-2 text-[13px] text-fog">
            <span className="font-semibold text-mist">{data.quote.author}</span>
            <span aria-label={`${data.quote.rating} out of 5 stars`}>
              {"★".repeat(data.quote.rating)}
              <span className="text-ink-700">{"★".repeat(5 - data.quote.rating)}</span>
            </span>
          </figcaption>
          <blockquote className="mt-2 text-[15px] leading-relaxed text-mist">“{data.quote.text}”</blockquote>
          {!data.quote.real && <p className="mt-2 text-[12px] text-fog">A typical review, to set your tone.</p>}
        </figure>
      )}

      {data.grid && <AllergenGrid grid={data.grid} value={grid} onChange={setGrid} disabled={disabled} />}
      {data.table && <DataTable table={data.table} />}
      {data.staffing && <StaffingEditor data={data.staffing} value={staffing} onChange={setStaffing} disabled={disabled} />}

      {data.link && (
        <a href={data.link.href} target="_blank" rel="noreferrer" className={`${secondary} inline-flex items-center`}>
          {data.link.label}
        </a>
      )}

      {options.length > 0 && !data.grid && (
        <div role={data.multi ? "group" : "radiogroup"} aria-label="Choices" className={data.layout === "cards" ? "grid gap-3 sm:grid-cols-2" : data.layout === "swatches" ? "grid gap-2 sm:grid-cols-2" : "flex flex-wrap gap-2"}>
          {options.map((o) => {
            const on = picked.includes(o.id);
            if (data.layout === "buttons")
              return (
                <button
                  key={o.id}
                  type="button"
                  role={data.multi ? "checkbox" : "radio"}
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => tap(o)}
                  className={`${secondary} ${on ? "!border-signal !bg-signal/15 !opacity-100" : ""}`}
                >
                  {o.label}
                </button>
              );
            return (
              <button
                key={o.id}
                type="button"
                role={data.multi ? "checkbox" : "radio"}
                aria-checked={on}
                disabled={disabled}
                onClick={() => tap(o)}
                className={`min-h-12 rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                  on ? "border-signal bg-signal/10" : "border-ink-700 bg-ink-900 hover:border-signal/60"
                } ${disabled && !on ? "opacity-50" : ""}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-3">
                    {o.swatches?.length ? (
                      <span aria-hidden className="flex -space-x-1.5">
                        {o.swatches.map((c) => (
                          <span key={c} className="h-8 w-8 rounded-full ring-2 ring-ink-900" style={{ background: c }} />
                        ))}
                      </span>
                    ) : null}
                    <span className="text-[15px] font-semibold text-mist">{o.label}</span>
                  </span>
                  <span aria-hidden className={`h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-signal bg-signal" : "border-ink-700"}`} />
                </span>
                {o.body && <span className="mt-2 block whitespace-pre-line text-[14px] leading-relaxed text-fog">{o.body}</span>}
                {o.swatches?.length ? <span className="mt-1 block font-mono text-[12px] text-fog">{o.swatches.join(" · ")}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {needsWords && !disabled && (
        <label className="block text-[14px] text-fog">
          <span className="sr-only">Your answer</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={data.layout === "cards" ? 4 : 2}
            placeholder={data.input!.placeholder}
            className="mt-1 w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-[15px] text-mist placeholder:text-fog focus:border-signal focus:outline-none"
          />
        </label>
      )}

      {data.upload && onFiles && <UploadCard accept={data.upload.accept} multiple={data.upload.multiple} label={data.upload.label} disabled={disabled} status={uploadStatus} onFiles={onFiles} />}

      {!disabled && (data.confirm || data.multi || needsWords || data.skip || data.grid || data.staffing) && (
        <div className="flex flex-wrap items-center gap-3">
          {(data.confirm || data.multi || needsWords || data.grid || data.staffing) && (data.options.length > 0 || wordsOnly) && (
            <button type="button" disabled={!ready} onClick={confirm} className={primary}>
              {data.grid ? "These are right" : data.staffing ? "Save these numbers" : "Confirm"}
            </button>
          )}
          {data.skip && (
            <button type="button" onClick={() => onAnswer({ choiceIds: ["skip_q"], label: "Skip this question" })} className="min-h-11 rounded-full px-3 text-[14px] text-fog underline-offset-4 hover:text-mist hover:underline">
              Skip this question
            </button>
          )}
        </div>
      )}
    </div>
  );
}
