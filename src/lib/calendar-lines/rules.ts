// The local calendar for owners (docs/pilot-sprint.md, "Local calendar for
// owners"): the upcoming events worth a line in the brief, e.g.
// "Sat: West Ham v Fulham, expect busier (+18%)". Only events on a day the
// forecast moves (10% or more off a normal day of that weekday), plus Ramadan,
// Eid, bank holidays and school holidays, which always show. A line can carry
// one campaign idea the owner takes with one tap ("Draft an offer").
// Pure (only the forecast's constants), so it's unit-tested (tests/calendar-lines.test.ts).
import { BASELINE } from "@/lib/forecast/baseline";
import type { DayAhead } from "@/lib/forecast/week-ahead-rules";
import type { UpcomingEvent } from "@/lib/upcoming-events-rules";

export type AlwaysKind = "ramadan" | "eid" | "bank_holiday" | "school_holiday";

export function alwaysKind(e: Pick<UpcomingEvent, "type" | "title">): AlwaysKind | null {
  if (e.type === "bank_holiday") return "bank_holiday";
  if (e.type === "school_holiday") return "school_holiday";
  if (e.type === "religious" && /ramadan/i.test(e.title)) return "ramadan";
  if (e.type === "religious" && /\beid\b/i.test(e.title)) return "eid";
  return null;
}

export type CalendarLine = {
  key: string; // the event and its first day: one idea per event, ever
  title: string;
  type: UpcomingEvent["type"];
  first: string; // first day inside the window
  last: string;
  always: AlwaysKind | null;
  pct: number | null; // the forecast's change on its (biggest) day against a normal day, when it moves it
  dummy: boolean;
};

const DAY_MS = 86_400_000;
const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

// How much the forecast moves a day (null: no forecast to say, or it isn't shown).
export function movePct(day: DayAhead | undefined, showRanges: boolean) {
  if (!showRanges || !day?.orders || !day.normal_orders) return null;
  return Math.round((day.orders / day.normal_orders - 1) * 100);
}

// The lines for the events in the window, soonest first. A date over several
// days (half term, Ramadan) is one line. Restaurant events (closures, offers)
// are the owner's own and never repeated back to them.
export function calendarLines(events: UpcomingEvent[], days: Map<string, DayAhead>, showRanges: boolean): CalendarLine[] {
  const spans = new Map<string, CalendarLine>();
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    if (e.type === "restaurant") continue;
    const open = [...spans.values()].find((s) => s.title === e.title && s.type === e.type && nextDay(s.last) === e.date);
    const pct = movePct(days.get(e.date), showRanges);
    const moves = pct !== null && Math.abs(pct) >= BASELINE.movesPct ? pct : null;
    if (open) {
      open.last = e.date;
      if (moves !== null && (open.pct === null || Math.abs(moves) > Math.abs(open.pct))) open.pct = moves;
      continue;
    }
    spans.set(`${e.type}:${e.date}:${e.title}`, {
      key: `${e.type}:${e.date}:${e.title}`,
      title: e.title,
      type: e.type,
      first: e.date,
      last: e.date,
      always: alwaysKind(e),
      pct: moves,
      dummy: e.source === "dummy",
    });
  }
  return [...spans.values()].filter((l) => l.always || l.pct !== null).sort((a, b) => a.first.localeCompare(b.first) || a.title.localeCompare(b.title));
}

const SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const short = (ymd: string) => SHORT[((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1];

// "Sat", "Today", "Mon–Fri", "From Wed", "Until Fri".
export function whenText(line: Pick<CalendarLine, "first" | "last">, today: string, windowEnd: string, startedBefore: boolean) {
  const one = (d: string) => (d === today ? "Today" : short(d));
  if (line.first === line.last && !startedBefore) return one(line.first);
  if (startedBefore && line.last >= windowEnd) return "All week";
  if (startedBefore) return `Until ${short(line.last)}`;
  if (line.last >= windowEnd && daysFrom(line.first, line.last) >= 6) return `From ${one(line.first)}`;
  return `${one(line.first)}–${short(line.last)}`;
}

export function lineText(line: CalendarLine, today: string, windowEnd: string, startedBefore = false) {
  const effect = line.pct === null ? "" : `, expect ${line.pct > 0 ? "busier" : "quieter"} (${line.pct > 0 ? "+" : "−"}${Math.abs(line.pct)}%)`;
  return `${whenText(line, today, windowEnd, startedBefore)}: ${line.title}${effect}`;
}

// ---------- Campaign ideas ----------

export type Suggestion = { question: string; request: string };

// Ideas go out for an event 3 to 7 days ahead: time to email, not so early it's forgotten.
export const SUGGEST_DAYS = { from: 3, to: 7 } as const;

const DAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const long = (ymd: string) => DAY_LONG[((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1];

// The idea for a line, if there is one. The request is what "Draft an offer"
// sends to the usual campaign flow (approval, discount cap, consent all apply).
export function suggestionFor(line: CalendarLine, today: string): Suggestion | null {
  if (line.dummy) return null;
  const ahead = daysFrom(today, line.first);
  if (ahead < SUGGEST_DAYS.from || ahead > SUGGEST_DAYS.to) return null;
  const day = long(line.first);
  const date = line.first;
  if (line.pct !== null && line.pct < 0) {
    return {
      question: `💡 ${day} looks quieter (${line.title}, −${Math.abs(line.pct)}%). Want me to draft an offer email to fill it?`,
      request: `${day} ${date} looks quieter than usual (${line.title}, about ${Math.abs(line.pct)}% below a normal ${day}). Draft an email offer to bring customers in that day.`,
    };
  }
  if (line.always === "eid") {
    return {
      question: `💡 ${line.title} is on ${day}. Want me to draft an Eid email to your regulars?`,
      request: `${line.title} is on ${day} ${date}. Draft an email to customers inviting them to celebrate Eid with us, with an offer for Eid.`,
    };
  }
  if (line.always === "ramadan") {
    return {
      question: `💡 Ramadan starts ${day}. Want me to draft an iftar offer email?`,
      request: `Ramadan starts on ${day} ${date}. Draft an email to customers about breaking the fast with us, with an iftar offer for Ramadan.`,
    };
  }
  if (line.pct !== null && line.pct > 0 && (line.type === "sport" || line.type === "local_event")) {
    return {
      question: `💡 ${line.title} on ${day} should be busier (+${line.pct}%). Want me to draft a match-day email to regulars?`,
      request: `${line.title} is on ${day} ${date} and we expect a busier day. Draft an email to customers about coming in before or after it.`,
    };
  }
  if (line.always === "bank_holiday") {
    return {
      question: `💡 ${line.title} is ${day}. Want me to draft a bank holiday email to regulars?`,
      request: `${line.title} is a bank holiday on ${day} ${date}. Draft an email to customers for the bank holiday.`,
    };
  }
  if (line.always === "school_holiday") {
    return {
      question: `💡 ${line.title} starts ${day}. Want me to draft a family offer email?`,
      request: `School holidays (${line.title}) start on ${day} ${date}. Draft an email offer for families during the school holidays.`,
    };
  }
  return null;
}

// The one idea to offer this morning: the soonest line with one, quieter days and
// Eid before the rest. Lines already offered (keys) are skipped.
export function pickSuggestion(lines: CalendarLine[], today: string, offered: Set<string>) {
  const rank = (l: CalendarLine) => (l.pct !== null && l.pct < 0 ? 0 : l.always === "eid" ? 1 : l.always === "ramadan" ? 2 : l.pct !== null ? 3 : 4);
  const candidates = lines
    .filter((l) => !offered.has(l.key))
    .map((l) => ({ line: l, s: suggestionFor(l, today) }))
    .filter((x): x is { line: CalendarLine; s: Suggestion } => x.s !== null)
    .sort((a, b) => rank(a.line) - rank(b.line) || a.line.first.localeCompare(b.line.first));
  return candidates[0] ?? null;
}

// ---------- School holidays: the restaurant's council ----------

export type SchoolCoverage =
  | { status: "covered"; council: string }
  | { status: "not_covered"; council: string }
  | { status: "no_postcode" };

// What the owner reads about school holidays when they aren't covered.
export function coverageNote(c: SchoolCoverage) {
  if (c.status === "covered") return null;
  if (c.status === "no_postcode") return "_School holidays: we couldn't find your council (no postcode in your address), so they aren't included. Add your postcode in settings._";
  const owner = /s$/i.test(c.council) ? `${c.council}'` : `${c.council}'s`; // Tower Hamlets', Newham's
  return `_School holidays: we don't have ${owner} term dates yet, so they aren't included here._`;
}
