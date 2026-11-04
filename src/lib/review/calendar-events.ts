// UK and community dates for the business review's "next 30 days", written by
// hand from official sources (checked 3 Nov 2026), never by AI. Each row says
// where its date comes from. Moon-sighted dates are marked uncertain: they're
// confirmed by the mosques nearer the time. No imports, so it's unit-tested.
//
// audience: "all" (every restaurant) or a community the owner says they plan
// for (restaurants.event_audiences). Never worked out from the cuisine.

export const AUDIENCES = ["all", "muslim", "hindu_sikh", "chinese_east_asian", "football"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Exclude<Audience, "all">, string> = {
  muslim: "Ramadan and Eid",
  hindu_sikh: "Diwali",
  chinese_east_asian: "Lunar New Year",
  football: "Big football matches",
};

export type CalendarEvent = {
  key: string;
  name: string;
  kind: "cultural" | "religious" | "bank_holiday" | "school_holiday" | "sport" | "season";
  starts_on: string;
  ends_on?: string;
  date_uncertain?: boolean;
  audience: Audience;
  source: string;
  notes?: string;
};

const GOVUK = "gov.uk/bank-holidays (England and Wales)";
const EASTER = "Easter Sunday 28 March 2027 (Good Friday and Easter Monday from gov.uk/bank-holidays)";
const TERMS = "Council term dates 2026-27 and 2027-28: Tower Hamlets, Newham and Redbridge (the same half terms)";

export const CALENDAR_EVENTS: CalendarEvent[] = [
  { key: "bonfire-night-2026", name: "Bonfire Night", kind: "cultural", starts_on: "2026-11-05", audience: "all", source: "Fixed date: 5 November" },
  { key: "diwali-2026", name: "Diwali", kind: "religious", starts_on: "2026-11-08", audience: "hindu_sikh", source: "Hindu calendar (Kartik Amavasya): Sunday 8 November 2026" },
  { key: "christmas-parties-2026", name: "Christmas party season", kind: "season", starts_on: "2026-11-20", ends_on: "2026-12-23", audience: "all", source: "Trade convention, no official date: late November to just before Christmas", notes: "A season, not a day: work parties and group bookings." },
  { key: "black-friday-2026", name: "Black Friday", kind: "cultural", starts_on: "2026-11-27", audience: "all", source: "The day after US Thanksgiving (Thursday 26 November 2026)" },
  { key: "christmas-eve-2026", name: "Christmas Eve", kind: "cultural", starts_on: "2026-12-24", audience: "all", source: "Fixed date: 24 December" },
  { key: "christmas-day-2026", name: "Christmas Day", kind: "bank_holiday", starts_on: "2026-12-25", audience: "all", source: GOVUK },
  { key: "boxing-day-2026", name: "Boxing Day", kind: "bank_holiday", starts_on: "2026-12-26", audience: "all", source: `${GOVUK}: the bank holiday is Monday 28 December`, notes: "Bank holiday on Monday 28 December." },
  { key: "school-christmas-2026", name: "School Christmas holidays", kind: "school_holiday", starts_on: "2026-12-21", ends_on: "2027-01-01", audience: "all", source: TERMS },
  { key: "new-years-eve-2026", name: "New Year's Eve", kind: "cultural", starts_on: "2026-12-31", audience: "all", source: "Fixed date: 31 December" },
  { key: "new-years-day-2027", name: "New Year's Day", kind: "bank_holiday", starts_on: "2027-01-01", audience: "all", source: GOVUK },
  { key: "lunar-new-year-2027", name: "Lunar New Year", kind: "cultural", starts_on: "2027-02-06", audience: "chinese_east_asian", source: "Chinese calendar: Saturday 6 February 2027, Year of the Goat" },
  { key: "ramadan-2027", name: "Ramadan", kind: "religious", starts_on: "2027-02-08", ends_on: "2027-03-09", date_uncertain: true, audience: "muslim", source: "Expected start Monday 8 February 2027 (moon sighting: may be a day later)", notes: "Iftar after sunset; daytime trade is quieter." },
  { key: "pancake-day-2027", name: "Pancake Day", kind: "cultural", starts_on: "2027-02-09", audience: "all", source: `Shrove Tuesday, 47 days before ${EASTER}` },
  { key: "valentines-2027", name: "Valentine's Day", kind: "cultural", starts_on: "2027-02-14", audience: "all", source: "Fixed date: 14 February" },
  { key: "half-term-feb-2027", name: "February half term", kind: "school_holiday", starts_on: "2027-02-15", ends_on: "2027-02-19", audience: "all", source: TERMS },
  { key: "mothers-day-2027", name: "Mother's Day", kind: "cultural", starts_on: "2027-03-07", audience: "all", source: `Mothering Sunday, three weeks before ${EASTER}`, notes: "Falls in Ramadan in 2027." },
  { key: "eid-al-fitr-2027", name: "Eid al-Fitr", kind: "religious", starts_on: "2027-03-10", date_uncertain: true, audience: "muslim", source: "Expected Wednesday 10 March 2027 (UK calculated crescent sighting, evening of 9 March; moon sighting)" },
  { key: "good-friday-2027", name: "Good Friday", kind: "bank_holiday", starts_on: "2027-03-26", audience: "all", source: GOVUK },
  { key: "easter-2027", name: "Easter weekend", kind: "bank_holiday", starts_on: "2027-03-27", ends_on: "2027-03-29", audience: "all", source: EASTER },
  { key: "school-easter-2027", name: "School Easter holidays", kind: "school_holiday", starts_on: "2027-03-29", ends_on: "2027-04-09", audience: "all", source: TERMS },
  { key: "early-may-2027", name: "Early May bank holiday", kind: "bank_holiday", starts_on: "2027-05-03", audience: "all", source: GOVUK },
  { key: "eid-al-adha-2027", name: "Eid al-Adha", kind: "religious", starts_on: "2027-05-16", date_uncertain: true, audience: "muslim", source: "Expected Sunday 16 May 2027 (10 Dhul Hijjah; moon sighting)" },
  { key: "fa-cup-final-2027", name: "FA Cup final", kind: "sport", starts_on: "2027-05-22", audience: "football", source: "The FA: Saturday 22 May 2027, Wembley" },
  { key: "spring-bank-2027", name: "Spring bank holiday", kind: "bank_holiday", starts_on: "2027-05-31", audience: "all", source: GOVUK },
  { key: "half-term-may-2027", name: "May half term", kind: "school_holiday", starts_on: "2027-05-31", ends_on: "2027-06-04", audience: "all", source: TERMS },
  { key: "ucl-final-2027", name: "Champions League final", kind: "sport", starts_on: "2027-06-05", audience: "football", source: "UEFA: Saturday 5 June 2027, Estadio Metropolitano, Madrid" },
  { key: "fathers-day-2027", name: "Father's Day", kind: "cultural", starts_on: "2027-06-20", audience: "all", source: "Third Sunday in June: 20 June 2027" },
  { key: "womens-world-cup-2027", name: "Women's World Cup", kind: "sport", starts_on: "2027-06-24", ends_on: "2027-07-25", audience: "football", source: "FIFA: 24 June to 25 July 2027, Brazil" },
  { key: "school-summer-2027", name: "School summer holidays", kind: "school_holiday", starts_on: "2027-07-23", ends_on: "2027-09-01", audience: "all", source: TERMS },
  { key: "summer-bank-2027", name: "Summer bank holiday", kind: "bank_holiday", starts_on: "2027-08-30", audience: "all", source: GOVUK },
  { key: "half-term-oct-2027", name: "October half term", kind: "school_holiday", starts_on: "2027-10-25", ends_on: "2027-10-29", audience: "all", source: "Redbridge council term dates 2027-28 (Tower Hamlets and Newham not yet published)" },
  { key: "halloween-2027", name: "Halloween", kind: "cultural", starts_on: "2027-10-31", audience: "all", source: "Fixed date: 31 October" },
  { key: "bonfire-night-2027", name: "Bonfire Night", kind: "cultural", starts_on: "2027-11-05", audience: "all", source: "Fixed date: 5 November" },
  { key: "christmas-parties-2027", name: "Christmas party season", kind: "season", starts_on: "2027-11-19", ends_on: "2027-12-23", audience: "all", source: "Trade convention, no official date: late November to just before Christmas", notes: "A season, not a day: work parties and group bookings." },
  { key: "black-friday-2027", name: "Black Friday", kind: "cultural", starts_on: "2027-11-26", audience: "all", source: "The day after US Thanksgiving (Thursday 25 November 2027)" },
  { key: "christmas-eve-2027", name: "Christmas Eve", kind: "cultural", starts_on: "2027-12-24", audience: "all", source: "Fixed date: 24 December" },
  { key: "christmas-day-2027", name: "Christmas Day", kind: "cultural", starts_on: "2027-12-25", audience: "all", source: `${GOVUK}: the bank holiday is Monday 27 December`, notes: "Bank holiday on Monday 27 December." },
  { key: "boxing-day-2027", name: "Boxing Day", kind: "cultural", starts_on: "2027-12-26", audience: "all", source: `${GOVUK}: the bank holiday is Tuesday 28 December`, notes: "Bank holiday on Tuesday 28 December." },
  { key: "new-years-eve-2027", name: "New Year's Eve", kind: "cultural", starts_on: "2027-12-31", audience: "all", source: "Fixed date: 31 December" },
];

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The events in the next `days` days (starting, or a season already running)
// that this restaurant plans for: "all", plus the communities its owner chose.
// Owner not asked yet (null): "all" only.
export function relevantEvents(events: CalendarEvent[], audiences: readonly string[] | null | undefined, today: string, days: number) {
  const until = addDays(today, days);
  const wanted = new Set(["all", ...(audiences ?? [])]);
  return events
    .filter((e) => wanted.has(e.audience))
    .filter((e) => (e.starts_on >= today && e.starts_on <= until) || (e.kind === "season" && e.starts_on <= until && (e.ends_on ?? e.starts_on) >= today))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

// Ramadan, for a restaurant that plans for it, on the day of an event.
export function inRamadan(events: CalendarEvent[], day: string) {
  return events.some((e) => e.key.startsWith("ramadan-") && e.starts_on <= day && (e.ends_on ?? e.starts_on) >= day);
}

// What the campaign writer is asked for. During Ramadan, a restaurant that
// plans for it offers iftar, never lunch (e.g. Mother's Day 2027).
export function campaignRequest(e: CalendarEvent, audiences: readonly string[] | null | undefined) {
  const ramadan = (audiences ?? []).includes("muslim") && inRamadan(CALENDAR_EVENTS, e.starts_on);
  return [
    `An email campaign for ${e.name} (${e.starts_on}${e.ends_on ? ` to ${e.ends_on}` : ""}). Any offer within the discount cap, and only from the approved kinds of offer.`,
    e.notes ? `Note: ${e.notes}` : "",
    ramadan ? "It falls during Ramadan: offer an iftar meal after sunset, not lunch. Never mention lunch." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// The coded check for that rule: a Ramadan campaign that mentions lunch is refused.
export function ramadanProblems(text: string, e: CalendarEvent, audiences: readonly string[] | null | undefined) {
  const ramadan = (audiences ?? []).includes("muslim") && inRamadan(CALENDAR_EVENTS, e.starts_on);
  return ramadan && /\blunch(es|time)?\b/i.test(text) ? [`${e.name} falls during Ramadan: say iftar, not lunch.`] : [];
}
