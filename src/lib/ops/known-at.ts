// "What was known at time T": forecasts are stored exactly as issued and never
// changed (weather_forecasts, forecasts). A back-test for a day must only use a
// forecast issued at or before its cut-off, never a later, better one. These
// pick that row; the SQL versions are weather_known_at and weather_hour_known_at.
// No imports, so it's unit-tested.

export type Issued = { issued_at: string };

const time = (t: string | Date) => (t instanceof Date ? t.getTime() : new Date(t).getTime());

// The latest row issued at or before the cut-off (null if none was known yet).
export function knownAt<T extends Issued>(rows: T[], cutoff: string | Date): T | null {
  const limit = time(cutoff);
  let best: T | null = null;
  for (const r of rows) {
    const t = time(r.issued_at);
    if (t > limit) continue;
    if (!best || t > time(best.issued_at)) best = r;
  }
  return best;
}

// For a day's weather forecast: rows for that target day, as known at the cut-off.
export function forecastForDay<T extends Issued & { target_day: string | null }>(rows: T[], day: string, cutoff: string | Date) {
  return knownAt(
    rows.filter((r) => r.target_day === day),
    cutoff,
  );
}

// For an hour's: rows for that UTC hour start.
export function forecastForHour<T extends Issued & { hour_start: string | null }>(rows: T[], hourStart: string | Date, cutoff: string | Date) {
  const want = time(hourStart);
  return knownAt(
    rows.filter((r) => r.hour_start !== null && time(r.hour_start) === want),
    cutoff,
  );
}

// The usual cut-off for forecasting a trading day: the evening before (18:00
// London time), when tomorrow's rota and prep are decided.
export function eveningBefore(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  // 18:00 London is 17:00 or 18:00 UTC; try both and keep the one that reads 18:00 in London.
  for (const utcHour of [17, 18]) {
    const t = new Date(Date.UTC(y, m - 1, d - 1, utcHour));
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(t));
    if (hour === 18) return t;
  }
  return new Date(Date.UTC(y, m - 1, d - 1, 18));
}
