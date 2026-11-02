"use client";
import { useState } from "react";
import { card, primary, secondary } from "./styles";
import type { ConfirmationData } from "./types";

// "Is this right?": what we hold (from the database, never Dina's words), shown as
// rows. "Looks right" confirms as it is; "Change something" turns the rows into
// boxes to correct, and sends back only what changed. A missing value says so.
export function ConfirmationCard({
  card: data,
  onConfirm,
  disabled = false,
}: {
  card: ConfirmationData;
  onConfirm: (changes: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(data.fields.map((f) => [f.key, f.value ?? ""])));
  const changes = () => Object.fromEntries(data.fields.filter((f) => (values[f.key] ?? "").trim() !== (f.value ?? "")).map((f) => [f.key, values[f.key].trim()]));

  return (
    <div className={`${card} overflow-hidden`}>
      <p className="border-b border-ink-700 px-4 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-fog">{data.title}</p>
      {editing ? (
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            onConfirm(changes());
          }}
        >
          {data.fields.map((f) => (
            <label key={f.key} className="block text-[14px] text-fog">
              {f.label}
              {f.multiline ? (
                <textarea
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  rows={3}
                  className="mt-1 block w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-3 text-[16px] text-mist"
                />
              ) : (
                <input
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className="mt-1 block min-h-12 w-full rounded-xl border border-ink-700 bg-ink-950 px-3 text-[16px] text-mist"
                />
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary}>
              Save changes
            </button>
            <button type="button" onClick={() => setEditing(false)} className={secondary}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="divide-y divide-ink-700">
            {data.fields.map((f) => (
              <div key={f.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3">
                <dt className="text-[14px] text-fog">{f.label}</dt>
                <dd className={`break-words text-[15px] ${f.value ? "text-mist" : "italic text-ember"}`}>{f.value || "Not given yet"}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-ink-700 p-4">
            <button type="button" disabled={disabled} onClick={() => onConfirm({})} className={primary}>
              Looks right
            </button>
            <button type="button" disabled={disabled} onClick={() => setEditing(true)} className={secondary}>
              Change something
            </button>
          </div>
        </>
      )}
    </div>
  );
}
