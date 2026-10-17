// "History, never overwrite": prices, pay rates, costs and targets are rows that
// are never changed. Two patterns (docs/data-model.md):
//   - one value over time (a dish's price, a pay rate, a target): each row has
//     effective_from and recorded_at; the value on a day is the row with the
//     latest effective_from on or before that day, ties going to the latest
//     recorded_at (a correction for the same day is a newer row).
//   - a set of items each with a span (availability, cover rules, fixed costs):
//     effective_from and effective_to (no longer applies from that day).
// knownAt: only rows recorded by then, so a back-test sees what was known at the
// time. Days are London "YYYY-MM-DD" strings (they compare as text).
// No imports, so it's unit-tested. The SQL versions are dish_price_on,
// pay_rate_on, ingredient_price_on and target_on.

export type Versioned = { effective_from: string; recorded_at: string; created_at?: string };
export type Spanned = { effective_from: string; effective_to?: string | null };

const time = (iso: string | Date) => (iso instanceof Date ? iso.getTime() : new Date(iso).getTime());

export function valueOn<T extends Versioned>(rows: T[], day: string, opts: { knownAt?: string | Date } = {}): T | null {
  const cutoff = opts.knownAt === undefined ? Infinity : time(opts.knownAt);
  let best: T | null = null;
  for (const r of rows) {
    if (r.effective_from > day || time(r.recorded_at) > cutoff) continue;
    if (
      !best ||
      r.effective_from > best.effective_from ||
      (r.effective_from === best.effective_from &&
        (time(r.recorded_at) > time(best.recorded_at) ||
          (time(r.recorded_at) === time(best.recorded_at) && (r.created_at ?? "") > (best.created_at ?? ""))))
    ) {
      best = r;
    }
  }
  return best;
}

// The items of a set that apply on a day.
export function activeOn<T extends Spanned>(rows: T[], day: string): T[] {
  return rows.filter((r) => r.effective_from <= day && (!r.effective_to || r.effective_to > day));
}

// A dish (or section) on the menu on a day: active_from <= day < active_to.
export function onMenuOn(row: { active_from: string; active_to?: string | null }, day: string) {
  return row.active_from <= day && (!row.active_to || row.active_to > day);
}

// The row in force from each change of a value, oldest first, for charts
// and back-tests (only rows known by knownAt).
export function timeline<T extends Versioned>(rows: T[], opts: { knownAt?: string | Date } = {}): T[] {
  const days = [...new Set(rows.map((r) => r.effective_from))].sort();
  return days.map((d) => valueOn(rows, d, opts)).filter((r, i): r is T => r !== null && r.effective_from === days[i]);
}
