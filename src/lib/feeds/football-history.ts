// Past Premier League fixtures with kick-off times, for the backfill
// (football-data.org's free tier only has the current season). From
// football-data.co.uk's free season files, as the synthetic data generator
// (analytics/generator/synth/outside/fetch.py, calendar.py premier_league).
// Parsing is pure and unit-tested; premierLeagueHistory fetches.
import { londonTime } from "@/lib/clock";
import { canonicalTeam, type Venue } from "./football";
import type { FixtureFeedRow } from "./types";

// Seasons by their football-data.co.uk code: 2025-26 = "2526".
export function seasonsBetween(from: string, to: string) {
  const start = (d: string) => (Number(d.slice(5, 7)) >= 7 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
  const out: string[] = [];
  for (let y = start(from); y <= start(to); y++) out.push(`${String(y % 100).padStart(2, "0")}${String((y + 1) % 100).padStart(2, "0")}`);
  return out;
}
export const seasonUrl = (code: string) => `https://www.football-data.co.uk/mmz4281/${code}/E0.csv`;

export function historyRows(csv: string, from: string, to: string, venues: Venue[], fetchedAt: string): FixtureFeedRow[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",");
  const col = (name: string) => head.indexOf(name);
  const [cDate, cTime, cHome, cAway] = [col("Date"), col("Time"), col("HomeTeam"), col("AwayTeam")];
  if (cDate < 0 || cHome < 0 || cAway < 0) return [];
  const rows: FixtureFeedRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const m = (c[cDate] ?? "").match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
    if (!m || !c[cHome] || !c[cAway]) continue;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const day = `${year}-${m[2]}-${m[1]}`;
    if (day < from || day > to) continue;
    const [hh, mm] = (c[cTime] || "15:00").split(":").map(Number);
    const kickoff = londonTime(year, Number(m[2]), Number(m[1]), hh || 15, mm || 0).toISOString();
    const home = canonicalTeam(c[cHome]);
    const away = canonicalTeam(c[cAway]);
    const venue = venues.find((v) => v.teams.includes(home)) ?? null;
    rows.push({
      external_source: "football-data.co.uk",
      external_id: `E0:${day}:${home}:${away}`,
      day,
      starts_at: kickoff,
      ends_at: new Date(Date.parse(kickoff) + 2 * 3_600_000).toISOString(),
      name: `${home} v ${away}`,
      type: "football",
      scope: "national",
      latitude: venue?.latitude ?? null,
      longitude: venue?.longitude ?? null,
      venue_id: venue?.id ?? null,
      expected_size: venue ? (venue.typical_crowd ?? venue.capacity) : null,
      source: "feed",
      fetched_at: fetchedAt,
      sport: "football",
      competition: "Premier League",
      home_team: home,
      away_team: away,
      kickoff_at: kickoff,
    });
  }
  return rows;
}

export async function premierLeagueHistory(from: string, to: string, venues: Venue[]) {
  const rows: FixtureFeedRow[] = [];
  const fetchedAt = new Date().toISOString();
  for (const code of seasonsBetween(from, to)) {
    // The site answers empty without a browser-like User-Agent.
    const res = await fetch(seasonUrl(code), { headers: { "User-Agent": "Mozilla/5.0 (DinerAI forecast backfill)" }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`football-data.co.uk ${res.status} for season ${code}`);
    rows.push(...historyRows(await res.text(), from, to, venues, fetchedAt));
  }
  return rows;
}
