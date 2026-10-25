// Upcoming events (docs/pilot-sprint.md): the dates that could make a day busier
// or quieter, from the local calendar (bank holidays, religious dates, school
// holidays, sport, local events) and the owner's own events (closures, offers).
// getUpcomingEvents (./upcoming-events.ts) reads them; in test mode a demo
// restaurant with none gets dummyUpcomingEvents instead.
// No imports beyond types, so it's unit-tested (tests/pilot-contracts.test.ts).
import type { CalendarType } from "./local-calendar-rules";

export type EventEffect = "busier" | "quieter" | "neutral";
export type EventType = CalendarType | "restaurant";
export type EventSource = "gov.uk" | "builder" | "feed" | "owner" | "dummy";

export type UpcomingEvent = {
  date: string; // London "YYYY-MM-DD" (an event over several days: one entry per day)
  title: string;
  type: EventType;
  expected_effect: EventEffect;
  source: EventSource;
};

// A first guess from the kind of date, before any forecast. The forecast's own
// reasons (forecast_drivers) are the real measure once it has learnt them.
export function expectedEffect(type: EventType, title: string, restaurantEventType?: string): EventEffect {
  if (type === "restaurant") {
    if (restaurantEventType === "closure" || restaurantEventType === "partial_closure" || restaurantEventType === "refit") return "quieter";
    if (restaurantEventType === "promotion") return "busier";
    return "neutral";
  }
  if (type === "bank_holiday" || type === "sport" || type === "local_event") return "busier";
  if (type === "religious") {
    if (/ramadan/i.test(title)) return "quieter";
    if (/eid|diwali|chand raat|christmas eve|new year'?s eve|mother'?s day|valentine/i.test(title)) return "busier";
  }
  return "neutral";
}

// Where a calendar row came from, in the contract's words.
export function sourceOf(source: string | null | undefined): EventSource {
  if (source === "gov.uk" || source === "feed" || source === "owner") return source;
  return "builder";
}

export function sortEvents(events: UpcomingEvent[]) {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// ---------- Dummy data (test mode only) ----------

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1

// Every week: a quieter Tuesday (closed at lunch), a busier Saturday (a home
// match) and a neutral Sunday (a school inset day). The same dates every time.
export function dummyUpcomingEvents(from: string, to: string): UpcomingEvent[] {
  const out: UpcomingEvent[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd === 2) out.push({ date: d, title: "Closed at lunch for a deep clean (dummy)", type: "restaurant", expected_effect: "quieter", source: "dummy" });
    if (wd === 6) out.push({ date: d, title: "Home football match (dummy)", type: "sport", expected_effect: "busier", source: "dummy" });
    if (wd === 7) out.push({ date: d, title: "School inset day tomorrow (dummy)", type: "school_holiday", expected_effect: "neutral", source: "dummy" });
  }
  return out;
}
