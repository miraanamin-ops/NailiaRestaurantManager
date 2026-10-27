// The local calendar: dates worth planning a campaign around (religious dates,
// school holidays, big matches, local events, bank holidays). Growth's calendar
// job drafts 2 to 3 weeks ahead of each one. No imports, so it's unit-tested
// (tests/local-calendar.test.ts).

export const CALENDAR_TYPES = ["religious", "school_holiday", "sport", "local_event", "bank_holiday"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export const CALENDAR_TYPE_LABELS: Record<CalendarType, string> = {
  religious: "Religious date",
  school_holiday: "School holiday",
  sport: "Sport",
  local_event: "Local event",
  bank_holiday: "Bank holiday",
};

export type CalendarEntry = {
  id: string;
  // null = every restaurant (bank holidays, Eid, Christmas); set = one restaurant's local event.
  restaurant_id: string | null;
  day: string; // YYYY-MM-DD
  end_day?: string | null; // the last day, for a date that runs several days (school holidays, Ramadan)
  name: string;
  type: CalendarType;
  date_uncertain: boolean;
  source: "builder" | "gov.uk";
};

// Growth drafts 2 to 3 weeks before a date, so the owner has time to plan stock and staff.
export const LOOKAHEAD = { from: 14, to: 21 } as const;

const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);

// The entries 14 to 21 days from today (inclusive), soonest first.
export function entriesToDraft<E extends Pick<CalendarEntry, "day">>(entries: E[], today: string, window: { from: number; to: number } = LOOKAHEAD) {
  const t = dayNumber(today);
  return entries
    .filter((e) => {
      const d = dayNumber(e.day) - t;
      return d >= window.from && d <= window.to;
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

// A new entry from the builder's form: what's wrong with it (empty = fine).
export function entryProblems(input: { day: string; name: string; type: string }) {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(`${input.day}T12:00:00Z`))) problems.push("a date like 2026-12-25");
  if (!input.name.trim()) problems.push("a name");
  if (!(CALENDAR_TYPES as readonly string[]).includes(input.type)) problems.push("a type");
  return problems;
}

// gov.uk bank holidays (already cached for Visibility) as calendar rows for every
// restaurant: only the ones not in the calendar yet, from today on.
export function bankHolidayRows(holidays: { date: string; title: string }[], existing: Pick<CalendarEntry, "day" | "name">[], today: string) {
  const have = new Set(existing.map((e) => `${e.day}|${e.name}`));
  return holidays
    .filter((h) => h.date >= today && !have.has(`${h.date}|${h.title}`))
    .map((h) => ({ restaurant_id: null, day: h.date, name: h.title, type: "bank_holiday" as const, date_uncertain: false, source: "gov.uk" as const }));
}
