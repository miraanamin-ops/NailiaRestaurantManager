// Disruption from the TfL Unified API (free; TFL_API_KEY lifts the limit to
// 500 calls a minute, and it works without one more slowly). Pure, unit-tested
// against saved real answers.
//
// Only what changes how people get about for a day:
//   strikes (industrial action) on any line   London, every restaurant in a London borough
//   a whole line closed for 4+ hours between 10:00 and 23:00
//                                             restaurants with a station on that line within 1 km
// Part closures and weekend engineering work are left out, or most weekends
// would count as disrupted. National Rail strikes have no clean free feed: the
// builder adds them on /feeds.
import type { CalendarFeedRow } from "./types";

export const TFL = "https://api.tfl.gov.uk";
export const MODES = "tube,dlr,overground,elizabeth-line";
export const STATION_RADIUS_M = 1000;

const withKey = (url: string, key?: string) => (key ? `${url}${url.includes("?") ? "&" : "?"}app_key=${encodeURIComponent(key)}` : url);
export const linesUrl = (key?: string) => withKey(`${TFL}/Line/Mode/${MODES}`, key);
export const statusUrl = (lineIds: string[], from: string, to: string, key?: string) =>
  withKey(`${TFL}/Line/${lineIds.join(",")}/Status/${from}T00:00:00/to/${to}T23:59:59`, key);
export const stationsUrl = (p: { lat: number; lon: number }, key?: string) =>
  withKey(`${TFL}/StopPoint/?lat=${p.lat}&lon=${p.lon}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=${STATION_RADIUS_M}`, key);

type LineStatus = { statusSeverity: number; statusSeverityDescription?: string; reason?: string; validityPeriods?: { fromDate: string; toDate: string }[] };
export type StatusAnswer = { id: string; name: string; lineStatuses?: LineStatus[] }[];
export type StationsAnswer = { stopPoints?: { lines?: { id: string }[] }[] };

const PLANNED_CLOSURE = 4;
const isStrike = (reason: string) => /\b(strike|strikes|industrial action)\b/i.test(reason);

const londonParts = (ms: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
};
// A period that ends in the small hours belongs to the day before (the night's service).
const lastDay = (ms: number) => londonParts(ms - 5 * 3_600_000).day;

// Minutes of a period inside 10:00 to 23:00 London time on each of its days (whole days counted from the hours).
function daytimeMinutes(fromMs: number, toMs: number) {
  let total = 0;
  for (let t = fromMs; t < toMs; t += 15 * 60_000) {
    const m = londonParts(t).minutes;
    if (m >= 600 && m < 1380) total += 15;
  }
  return total;
}

export function disruptionRows(json: StatusAnswer, fetchedAt: string): { strikes: CalendarFeedRow[]; closures: (CalendarFeedRow & { line: string })[] } {
  const strikes: CalendarFeedRow[] = [];
  const closures: (CalendarFeedRow & { line: string })[] = [];
  const seen = new Set<string>();
  for (const line of json) {
    for (const s of line.lineStatuses ?? []) {
      const reason = s.reason ?? "";
      for (const v of s.validityPeriods ?? []) {
        const from = Date.parse(v.fromDate);
        const to = Date.parse(v.toDate);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
        const day = londonParts(from).day;
        const end = lastDay(to) > day ? lastDay(to) : null;
        const base = { day, end_day: end, starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(), type: "disruption" as const,
          external_source: "tfl", source: "feed" as const, fetched_at: fetchedAt, notes: reason.slice(0, 300) || null };
        if (isStrike(reason)) {
          const id = `strike:${line.id}:${v.fromDate}`;
          if (seen.has(id)) continue;
          seen.add(id);
          strikes.push({ ...base, external_id: id, name: `Strike (${line.name})`, scope: "regional", region: "london" });
        } else if (s.statusSeverity === PLANNED_CLOSURE && daytimeMinutes(from, to) >= 240) {
          const id = `closure:${line.id}:${v.fromDate}`;
          if (seen.has(id)) continue;
          seen.add(id);
          closures.push({ ...base, external_id: id, name: `${line.name} closed`, scope: "local", line: line.id });
        }
      }
    }
  }
  return { strikes, closures };
}

export const nearbyLines = (json: StationsAnswer) => [...new Set((json.stopPoints ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.id)))].sort();
