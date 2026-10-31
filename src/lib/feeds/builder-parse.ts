// The builder's WhatsApp commands (from BUILDER_WHATSAPP only, each starting
// with "BUILDER "). Parsing only, no imports, unit-tested.
//
//   BUILDER HELP
//   BUILDER FEEDS                          each feed's last success and any problem
//   BUILDER RUN WEATHER                    run a feed now (weather, calendar, prayer,
//                                          football, events, disruption, terms, all)
//   BUILDER EID CONFIRMED FOR TUESDAY      an uncertain date confirmed: the next Eid
//   BUILDER EID AL-ADHA CONFIRMED 27 MAY   (al-Fitr or al-Adha, whichever is next, or
//   BUILDER RAMADAN STARTS WEDNESDAY       named), Ramadan's start, Diwali; for the East
//   BUILDER DIWALI CONFIRMED 8 NOV         London Mosque unless "UK" / "UK MOONSIGHTING"
//   BUILDER EID CONFIRMED TUE UK           says otherwise
//   BUILDER GOOGLE ACCEPTED ember-spice    Google accepted our manager invite for a
//                                          restaurant setting up (its link name, or its name)

export type ConfirmKind = "eid" | "eid_fitr" | "eid_adha" | "ramadan" | "diwali";
export type DateWord = { kind: "weekday"; weekday: number } | { kind: "relative"; days: number } | { kind: "date"; day: number; month: number; year: number | null };

export type BuilderCommand =
  | { kind: "help" }
  | { kind: "feeds" }
  | { kind: "run"; feed: string }
  | { kind: "confirm"; what: ConfirmKind; date: DateWord; authority: "east-london-mosque" | "uk-moonsighting" }
  | { kind: "google_accepted"; restaurant: string }
  | { kind: "unknown"; text: string };

export const BUILDER_PREFIX = /^\s*builder\b[:\s]*/i;
export const isBuilderCommand = (body: string) => BUILDER_PREFIX.test(body);

// Only the builder's own number (BUILDER_WHATSAPP, e.g. whatsapp:+447700900123) can send builder commands.
export function isBuilderNumber(from: string, builderWhatsapp: string | undefined) {
  const norm = (s: string) => s.replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  return Boolean(builderWhatsapp?.trim()) && norm(from) === norm(builderWhatsapp ?? "");
}

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const FEEDS: Record<string, string> = {
  weather: "weather", calendar: "calendar", prayer: "prayer", prayers: "prayer", football: "football", events: "events", event: "events",
  disruption: "disruption", tfl: "disruption", terms: "school_terms", school: "school_terms", schools: "school_terms", all: "all",
};

export function parseDateWord(text: string): DateWord | null {
  const t = text.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t === "today" || t === "tonight") return { kind: "relative", days: 0 };
  if (t === "tomorrow") return { kind: "relative", days: 1 };
  const wd = t.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/);
  if (wd) return { kind: "weekday", weekday: WEEKDAYS[wd[1]] };
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { kind: "date", year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = t.match(/^(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]* )?(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]*(?: (\d{4}))?$/);
  if (m && MONTHS[m[2]]) return { kind: "date", day: Number(m[1]), month: MONTHS[m[2]], year: m[3] ? Number(m[3]) : null };
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) return { kind: "date", day: Number(m[1]), month: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  return null;
}

export function parseBuilderCommand(body: string): BuilderCommand {
  const text = body.replace(BUILDER_PREFIX, "").trim();
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t === "help" || t === "?") return { kind: "help" };
  if (t === "feeds" || t === "feed" || t === "status") return { kind: "feeds" };
  const accepted = text.match(/^google (?:invite )?accepted(?: for)?\s+(.+)$/i);
  if (accepted) return { kind: "google_accepted", restaurant: accepted[1].trim() };
  const run = t.match(/^run (\w+)$/);
  if (run) return FEEDS[run[1]] ? { kind: "run", feed: FEEDS[run[1]] } : { kind: "unknown", text };

  let rest = t;
  let authority: "east-london-mosque" | "uk-moonsighting" = "east-london-mosque";
  const auth = rest.match(/\(?\b(uk moon ?sighting|uk moonsighting|ukm|uk|elm|east london mosque)\b\)?/);
  if (auth) {
    if (!/elm|east london/.test(auth[1])) authority = "uk-moonsighting";
    rest = rest.replace(auth[0], " ").replace(/\s+/g, " ").trim();
  }
  const what = rest.match(/^(eid (?:al|ul|-)?[ -]?fitr|eid (?:al|ul|-)?[ -]?adha|eid|ramadan|diwali)\b/);
  if (!what) return { kind: "unknown", text };
  const w = what[1].replace(/\s+/g, " ");
  const kind: ConfirmKind = w.includes("fitr") ? "eid_fitr" : w.includes("adha") ? "eid_adha" : w === "eid" ? "eid" : (w as "ramadan" | "diwali");
  const after = rest.slice(what[0].length).trim().replace(/^(is )?(confirmed|confirm|starts|started|begins|is on|on)\b/, "").trim().replace(/^(for|on|as)\b/, "").trim();
  const date = parseDateWord(after);
  if (!date) return { kind: "unknown", text };
  return { kind: "confirm", what: kind, date, authority };
}

// The day a date word means, near the expected day (within 3 days for a weekday;
// a date without a year takes the expected day's year, or the next one if that's closer).
export function resolveDateWord(word: DateWord, expected: string, today: string): string | null {
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (word.kind === "relative") return ymd(utc(today) + word.days * 86_400_000);
  if (word.kind === "weekday") {
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const t = utc(expected) + off * 86_400_000;
      if (new Date(t).getUTCDay() === word.weekday) return ymd(t);
    }
    return null;
  }
  const year = word.year ?? Number(expected.slice(0, 4));
  const t = Date.UTC(year, word.month - 1, word.day);
  const d = new Date(t);
  if (d.getUTCMonth() !== word.month - 1 || d.getUTCDate() !== word.day) return null;
  return ymd(t);
}

export const BUILDER_HELP = [
  "🛠️ *Builder commands* (start each with BUILDER):",
  "FEEDS: each outside data feed's last success and any problem",
  "RUN WEATHER (or CALENDAR, PRAYER, FOOTBALL, EVENTS, DISRUPTION, TERMS, ALL): run a feed now",
  "EID CONFIRMED FOR TUESDAY: confirm the next Eid's date (also EID AL-ADHA, RAMADAN STARTS, DIWALI; add UK for UK moon sighting)",
  "GOOGLE ACCEPTED ember-spice: Google accepted our manager invite for a restaurant setting up (its link name or its name)",
].join("\n");
