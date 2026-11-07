"use client";
import type { QuestionCardData } from "./types";

// The allergen grid (owner's call, 7 Nov 2026: "one by one was tedious"): dishes
// down the side, the 14 allergens and the dietary tags along the top, an X in
// each cell. Tap a cell to add or remove it. Rows still only suggested are marked
// so; "Not sure" leaves a dish unknown (never shown to customers). Scrolls
// sideways inside its own box on a phone, never the page.

type Grid = NonNullable<QuestionCardData["grid"]>;
export type GridValue = Record<string, string[] | "unsure">;

export function initialGrid(grid: Grid): GridValue {
  return Object.fromEntries(grid.rows.map((r) => [r.id, r.unsure ? "unsure" : [...r.marked]]));
}

export function AllergenGrid({ grid, value, onChange, disabled = false }: { grid: Grid; value: GridValue; onChange: (v: GridValue) => void; disabled?: boolean }) {
  const toggle = (row: string, col: string) => {
    const cur = value[row];
    const marks = cur === "unsure" ? [] : (cur ?? []);
    onChange({ ...value, [row]: marks.includes(col) ? marks.filter((c) => c !== col) : [...marks, col] });
  };
  // A section heading above the first dish of each section.
  const firstOfSection = new Set(grid.rows.filter((r, i) => i === 0 || grid.rows[i - 1].section !== r.section).map((r) => r.id));
  return (
    <div className="space-y-2">
      <div className="max-h-[60vh] overflow-auto rounded-2xl border border-ink-700">
        <table className="min-w-max border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-ink-900">
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-ink-900 px-3 py-2 text-left font-semibold text-mist">
                Dish
              </th>
              {grid.columns.map((c) => (
                <th key={c.id} scope="col" title={c.label} className={`px-1.5 py-2 text-center font-medium ${c.id.startsWith("diet:") ? "text-signal" : "text-fog"}`}>
                  <span className="block w-12 truncate">{c.short}</span>
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium text-fog">
                Not sure
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => {
              const v = value[r.id];
              const unsure = v === "unsure";
              const head = firstOfSection.has(r.id);
              return (
                <FragmentRow key={r.id} head={head ? r.section : null} cols={grid.columns.length + 2}>
                  <tr className={`border-t border-ink-800 ${unsure ? "opacity-60" : ""}`}>
                    <th scope="row" className="sticky left-0 bg-ink-950 px-3 py-2 text-left font-normal text-mist">
                      <span className="block max-w-[11rem] truncate">{r.label}</span>
                      {r.suggested && !unsure && <span className="block text-[11px] text-fog">Suggested, please check</span>}
                    </th>
                    {grid.columns.map((c) => {
                      const on = !unsure && (v as string[] | undefined)?.includes(c.id);
                      return (
                        <td key={c.id} className="p-0.5 text-center">
                          <button
                            type="button"
                            disabled={disabled || unsure}
                            aria-pressed={Boolean(on)}
                            aria-label={`${r.label}: ${c.label}`}
                            onClick={() => toggle(r.id, c.id)}
                            className={`h-9 w-12 rounded-lg text-[15px] font-bold transition ${on ? "bg-signal/20 text-signal ring-1 ring-signal" : "text-ink-700 hover:bg-ink-800"}`}
                          >
                            {on ? "X" : "·"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 text-center">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={unsure}
                        aria-label={`Not sure about ${r.label}`}
                        onChange={(e) => onChange({ ...value, [r.id]: e.target.checked ? "unsure" : r.marked.slice() })}
                        className="h-5 w-5 accent-[#c8f03c]"
                      />
                    </td>
                  </tr>
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-fog">V vegetarian, VG vegan, GF gluten free. Tap a box to add or remove an X.</p>
    </div>
  );
}

function FragmentRow({ head, cols, children }: { head: string | null; cols: number; children: React.ReactNode }) {
  return (
    <>
      {head && (
        <tr>
          <td colSpan={cols} className="sticky left-0 bg-ink-900 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-fog">
            {head}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
