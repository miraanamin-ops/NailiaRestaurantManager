"use client";
import type { StaffingAnswer, StaffingCardData, StaffingRowData } from "./types";

// "How many people you need" (owner's plan, 12 Nov 2026): one row per role on the
// team, each with the fewest on shift whenever open and "1 more per N orders an
// hour", both with − and +. Prefilled by code (from their rotas, or the suggestion
// for their size); what each number is based on is shown under the row.

export const initialStaffing = (s: StaffingCardData): StaffingAnswer => Object.fromEntries(s.rows.map((r) => [r.role, { min: r.min, per: r.per }]));

// The steps "1 more per" moves through.
const PER_STEPS = [3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50, 60, 80];
const nextPer = (per: number | null, dir: 1 | -1): number | null => {
  if (per === null) return dir === 1 ? PER_STEPS[0] : null;
  if (dir === 1) return PER_STEPS.find((x) => x > per) ?? null; // past the last: no busy rule
  const lower = [...PER_STEPS].reverse().find((x) => x < per);
  return lower ?? per;
};

function Stepper({ label, value, onDown, onUp, disabled }: { label: string; value: string; onDown: () => void; onUp: () => void; disabled?: boolean }) {
  const btn = "flex h-9 w-9 items-center justify-center rounded-full border border-ink-700 text-[18px] text-mist hover:border-signal disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`Fewer: ${label}`} disabled={disabled} onClick={onDown} className={btn}>
        −
      </button>
      <span aria-live="polite" className="min-w-[4.5rem] text-center text-[15px] font-semibold text-mist">
        {value}
      </span>
      <button type="button" aria-label={`More: ${label}`} disabled={disabled} onClick={onUp} className={btn}>
        +
      </button>
    </div>
  );
}

const basis = (r: StaffingRowData, v: { min: number; per: number | null }) => {
  const words = (x: { min: number; per: number | null }) => `${x.min}${x.per ? `, +1 per ${x.per}` : ""}`;
  const parts = [r.learned ? `Your rotas: ${words(r.learned)}${r.learned.estimate ? " (estimate)" : ""}` : null, r.suggested ? `For your size: ${words(r.suggested)}` : null].filter(Boolean);
  const changed = (r.learned && (v.min !== r.learned.min || v.per !== r.learned.per)) || (!r.learned && r.suggested && (v.min !== r.suggested.min || v.per !== r.suggested.per));
  return { text: parts.join(" · "), changed };
};

export function StaffingEditor({ data, value, onChange, disabled }: { data: StaffingCardData; value: StaffingAnswer; onChange: (v: StaffingAnswer) => void; disabled?: boolean }) {
  const set = (role: string, v: { min: number; per: number | null }) => onChange({ ...value, [role]: v });
  return (
    <div className="space-y-2">
      {data.rows.map((r) => {
        const v = value[r.role] ?? { min: r.min, per: r.per };
        const b = basis(r, v);
        return (
          <div key={r.role} className="rounded-2xl border border-ink-700 bg-ink-900 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[15px] font-semibold text-mist">{r.label}</span>
              {r.hint && <span className="text-[12px] text-fog">{r.hint}</span>}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-[12px] text-fog">At least, whenever open</p>
                <Stepper
                  label={`${r.label} at least`}
                  value={String(v.min)}
                  disabled={disabled}
                  onDown={() => set(r.role, { ...v, min: Math.max(0, v.min - 1) })}
                  onUp={() => set(r.role, { ...v, min: Math.min(20, v.min + 1) })}
                />
              </div>
              {r.orders && (
                <div>
                  <p className="text-[12px] text-fog">1 more per … {r.orders} an hour</p>
                  <Stepper
                    label={`${r.label} 1 more per`}
                    value={v.per ? String(v.per) : "never"}
                    disabled={disabled}
                    onDown={() => set(r.role, { ...v, per: nextPer(v.per, -1) })}
                    onUp={() => set(r.role, { ...v, per: nextPer(v.per, 1) })}
                  />
                </div>
              )}
            </div>
            {(b.text || r.edges) && (
              <p className="mt-2 text-[12px] leading-relaxed text-fog">
                {b.text}
                {b.changed ? " · changed by you" : ""}
                {r.edges ? `${b.text ? " · " : ""}${r.edges}` : ""}
              </p>
            )}
          </div>
        );
      })}
      {data.notes.length > 1 && (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fog">
          {data.notes.slice(1).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DataTable({ table }: { table: { columns: string[]; rows: string[][] } }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-700">
      <table className="w-full min-w-[22rem] text-left text-[13px]">
        <thead className="bg-ink-950 text-fog">
          <tr>
            {table.columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t border-ink-700 text-mist">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "font-semibold" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
