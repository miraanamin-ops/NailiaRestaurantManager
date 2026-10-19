// Football fixtures from football-data.org (free tier: 12 competitions, 10
// calls a minute; API key in FOOTBALL_DATA_API_KEY), and the rules that turn a
// match into the calendar row and fixture the forecast model reads. Pure,
// unit-tested.
//
// Free competitions used: Premier League (PL), Champions League (CL), and the
// World Cup (WC) and European Championship (EC) finals for England. England's
// friendlies, qualifiers and Nations League aren't on the free tier: the
// builder enters them on /feeds (as cricket).
import type { FixtureFeedRow } from "./types";

export const COMPETITIONS = ["PL", "CL", "WC", "EC"] as const;
export const FOOTBALL_DATA = "https://api.football-data.org/v4";
export const matchesUrl = (code: string, from: string, to: string) => `${FOOTBALL_DATA}/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`;

// The model reads importance from the competition's words (events.py importance):
// friendly 0.5; league, cup or qualifier 1; tournament group 1.5; knockout 2;
// semi-final or final 2.5. So the stage goes into the competition's name.
const NAMES: Record<string, string> = { PL: "Premier League", CL: "Champions League", WC: "World Cup", EC: "European Championship" };
const STAGES: Record<string, string> = {
  REGULAR_SEASON: "",
  LEAGUE_STAGE: "league phase",
  GROUP_STAGE: "group stage",
  PLAYOFFS: "knockout play-off",
  PLAYOFF_ROUND: "knockout play-off",
  ROUND_OF_32: "round of 32",
  LAST_32: "round of 32",
  LAST_16: "round of 16",
  ROUND_OF_16: "round of 16",
  QUARTER_FINALS: "quarter-final",
  SEMI_FINALS: "semi-final",
  THIRD_PLACE: "third place",
  FINAL: "final",
};
export function competitionText(code: string, stage: string | null | undefined, name?: string) {
  const base = NAMES[code] ?? name ?? code;
  const s = STAGES[stage ?? ""] ?? (stage ? stage.toLowerCase().replace(/_/g, " ") : "");
  return s ? `${base} ${s}` : base;
}

// One name per team, the same in fixtures and restaurant_teams (the model
// matches them exactly). football-data.org's short names, plus the other
// spellings owners and other sources use.
const ALIASES: Record<string, string> = {
  spurs: "Tottenham", "tottenham hotspur": "Tottenham", "west ham united": "West Ham", hammers: "West Ham",
  "arsenal fc": "Arsenal", gunners: "Arsenal", "chelsea fc": "Chelsea", "crystal palace fc": "Crystal Palace", palace: "Crystal Palace",
  "fulham fc": "Fulham", "brentford fc": "Brentford", "manchester united": "Man United", "man utd": "Man United",
  "manchester city": "Man City", "liverpool fc": "Liverpool", "newcastle united": "Newcastle", "aston villa fc": "Aston Villa",
  "nott'm forest": "Nottingham", "nottingham forest": "Nottingham", "wolverhampton wanderers": "Wolverhampton", wolves: "Wolverhampton",
  "brighton & hove albion": "Brighton Hove", brighton: "Brighton Hove", "leeds united": "Leeds United", england: "England",
  pakistan: "Pakistan", india: "India", bangladesh: "Bangladesh", "sri lanka": "Sri Lanka",
};
export function canonicalTeam(name: string, known: string[] = []) {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return "";
  const k = known.find((t) => t.toLowerCase() === key);
  if (k) return k;
  return ALIASES[key] ?? name.trim().replace(/\s+/g, " ");
}

type Team = { name?: string; shortName?: string | null; tla?: string | null };
type Match = {
  id: number;
  utcDate: string;
  status: string;
  stage?: string | null;
  competition?: { code?: string; name?: string };
  homeTeam?: Team;
  awayTeam?: Team;
  venue?: string | null;
};
export type MatchesAnswer = { matches?: Match[]; competition?: { code?: string; name?: string } };

export type Venue = { id: string; name: string; latitude: number; longitude: number; capacity: number | null; typical_crowd: number | null; teams: string[] };

const teamName = (t: Team | undefined) => canonicalTeam(t?.shortName || t?.name || "");
const londonDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

// Matches to keep (and ones to take out: postponed or cancelled since we saved them).
export function fixtureRows(json: MatchesAnswer, venues: Venue[], fetchedAt: string): { rows: FixtureFeedRow[]; removed: string[] } {
  const rows: FixtureFeedRow[] = [];
  const removed: string[] = [];
  for (const m of json.matches ?? []) {
    const code = m.competition?.code ?? json.competition?.code ?? "";
    const externalId = `${code}:${m.id}`;
    if (["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"].includes(m.status)) {
      removed.push(externalId);
      continue;
    }
    const home = teamName(m.homeTeam);
    const away = teamName(m.awayTeam);
    if (!home || !away || !m.utcDate) continue;
    // The home side's stadium, if it's one of ours (London Stadium, Tottenham Hotspur Stadium...): its crowd counts nearby.
    const venue = venues.find((v) => v.teams.includes(home)) ?? null;
    const kickoff = new Date(m.utcDate).toISOString();
    rows.push({
      external_source: "football-data.org",
      external_id: externalId,
      day: londonDay(kickoff),
      starts_at: kickoff,
      ends_at: new Date(Date.parse(kickoff) + 2 * 3_600_000).toISOString(),
      name: `${home} v ${away}`,
      type: "football",
      // National: everyone watches on TV (the model keeps only the restaurant's teams); a crowd fades with distance.
      scope: "national",
      latitude: venue?.latitude ?? null,
      longitude: venue?.longitude ?? null,
      venue_id: venue?.id ?? null,
      expected_size: venue ? (venue.typical_crowd ?? venue.capacity) : null,
      notes: m.status === "SCHEDULED" ? "Kick-off time not confirmed yet" : null,
      source: "feed",
      fetched_at: fetchedAt,
      sport: "football",
      competition: competitionText(code, m.stage, m.competition?.name),
      home_team: home,
      away_team: away,
      kickoff_at: kickoff,
    });
  }
  return { rows, removed };
}

// A match the builder types in (cricket, or England outside the free tier).
export type ManualMatch = { sport: "football" | "cricket"; competition: string; home: string; away: string; kickoff: string; venueId?: string | null };
export function manualMatchProblems(m: ManualMatch): string | null {
  if (!m.home.trim() || !m.away.trim()) return "both teams are needed";
  if (m.home.trim().toLowerCase() === m.away.trim().toLowerCase()) return "the teams are the same";
  if (!m.competition.trim()) return "the competition is needed (e.g. \"Friendly\", \"World Cup qualifier\", \"T20 World Cup semi-final\")";
  if (Number.isNaN(Date.parse(m.kickoff))) return "the start time isn't a date and time";
  return null;
}
export function manualMatchRow(m: ManualMatch, venues: Venue[], fetchedAt: string): FixtureFeedRow {
  const home = canonicalTeam(m.home);
  const away = canonicalTeam(m.away);
  const kickoff = new Date(m.kickoff).toISOString();
  const venue = m.venueId ? (venues.find((v) => v.id === m.venueId) ?? null) : null;
  // A cricket match lasts much longer than a football one; the model only uses the start.
  const hours = m.sport === "cricket" ? 8 : 2;
  return {
    external_source: "builder",
    external_id: `${m.sport}:${londonDay(kickoff)}:${home}:${away}`,
    day: londonDay(kickoff),
    starts_at: kickoff,
    ends_at: new Date(Date.parse(kickoff) + hours * 3_600_000).toISOString(),
    name: `${home} v ${away}`,
    type: m.sport === "football" ? "football" : "sport",
    scope: "national",
    latitude: venue?.latitude ?? null,
    longitude: venue?.longitude ?? null,
    venue_id: venue?.id ?? null,
    expected_size: venue ? (venue.typical_crowd ?? venue.capacity) : null,
    source: "builder",
    fetched_at: fetchedAt,
    sport: m.sport,
    competition: m.competition.trim(),
    home_team: home,
    away_team: away,
    kickoff_at: kickoff,
  };
}
