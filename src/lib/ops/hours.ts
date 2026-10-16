// London trading days and hours, correct across the clock changes. Timestamps are
// stored in UTC; business dates and hours are Europe/London. A London day has 23
// hours (last Sunday of March: 01:00 doesn't happen), 25 (last Sunday of
// October: 01:00 happens twice) or 24. No imports, so it's unit-tested. The SQL
// versions are london_day, london_hour, london_hour_start and london_hour_minutes.

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

// The London day ("YYYY-MM-DD") and hour (0 to 23) of a moment.
export function londonDayHour(at: Date): { day: string; hour: number } {
  const p = Object.fromEntries(PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export type LondonHour = { day: string; hour: number; start: Date; minutes: number };

// Every real hour of a London day, in order: each UTC hour whose London day is
// `day`. The October change gives hour 1 twice (two entries), March skips it.
export function londonHoursOf(day: string): LondonHour[] {
  const [y, m, d] = day.split("-").map(Number);
  const out: LondonHour[] = [];
  // A London day starts at 23:00 or 00:00 UTC: 22:00 the day before to 02:00 after covers both.
  for (let t = Date.UTC(y, m - 1, d - 1, 22); t < Date.UTC(y, m - 1, d + 1, 2); t += 3_600_000) {
    const at = new Date(t);
    const local = londonDayHour(at);
    if (local.day === day) out.push({ day, hour: local.hour, start: at, minutes: 60 });
  }
  return out;
}

// A till-style hour (a London hour on a day, as sales_hours stores it): when it
// first started and how long it lasted. 120 minutes for the repeated October
// hour, 0 for the March hour that doesn't exist (start = where it would be).
export function londonHourSpan(day: string, hour: number): { start: Date; minutes: number } {
  const hours = londonHoursOf(day).filter((h) => h.hour === hour);
  if (hours.length) return { start: hours[0].start, minutes: hours.length * 60 };
  const next = londonHoursOf(day).find((h) => h.hour > hour);
  return { start: next ? next.start : new Date(NaN), minutes: 0 };
}

// How many hours a London day has (23, 24 or 25).
export function hoursInLondonDay(day: string) {
  return londonHoursOf(day).length;
}
