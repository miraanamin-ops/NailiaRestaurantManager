// The feeds' database functions (supabase/041_outside_feeds.sql) for the
// in-memory stand-in (memory-db.ts), with the same rules: one row per
// (external_source, external_id), a confirmed row keeps its dates, forecasts as
// issued are only ever added. The SQL itself is tested in PGlite
// (tests/outside-feeds-schema.test.ts).
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
const FIELDS = [
  "restaurant_id", "day", "end_day", "starts_at", "ends_at", "name", "type", "scope", "region", "council_code", "latitude", "longitude", "venue_id",
  "expected_size", "date_uncertain", "alt_day", "alt_probability", "authority", "notes",
];

function upsertCalendar(tables: Record<string, Row[]>, rows: Row[]) {
  tables.local_calendar ??= [];
  let inserted = 0, updated = 0, kept = 0;
  for (const r of rows) {
    if (!r.external_source || !r.external_id) throw new Error("feed_upsert_calendar: every row needs external_source and external_id");
    const found = tables.local_calendar.find((x) => x.external_source === r.external_source && x.external_id === r.external_id);
    const values = Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? (f === "date_uncertain" ? false : null)]));
    if (!found) {
      tables.local_calendar.push({ id: randomUUID(), ...values, source: r.source ?? "feed", external_source: r.external_source, external_id: r.external_id, fetched_at: r.fetched_at ?? new Date().toISOString(), confirmed_at: null, created_at: new Date().toISOString() });
      inserted++;
    } else if (found.confirmed_at) {
      found.fetched_at = r.fetched_at ?? new Date().toISOString();
      kept++;
    } else {
      const changed = FIELDS.some((f) => JSON.stringify(found[f] ?? null) !== JSON.stringify(values[f] ?? null));
      Object.assign(found, values, { source: r.source ?? "feed", fetched_at: r.fetched_at ?? new Date().toISOString() });
      if (changed) updated++;
    }
  }
  return { inserted, updated, kept };
}

export function feedRpc(tables: Record<string, Row[]>, fn: string, args: Record<string, unknown>) {
  const rows = (args.p_rows ?? []) as Row[];
  try {
    if (fn === "feed_upsert_calendar") return { data: [upsertCalendar(tables, rows)], error: null };
    if (fn === "feed_upsert_fixtures") {
      const counts = upsertCalendar(tables, rows);
      tables.football_fixtures ??= [];
      for (const r of rows) {
        const event = tables.local_calendar.find((x) => x.external_source === r.external_source && x.external_id === r.external_id)!;
        const fixture = { event_id: event.id, sport: r.sport ?? "football", competition: r.competition, home_team: r.home_team, away_team: r.away_team, kickoff_at: r.kickoff_at, venue_id: r.venue_id ?? null, external_source: r.external_source, external_id: r.external_id, source: r.source ?? "feed" };
        const found = tables.football_fixtures.find((f) => f.event_id === event.id);
        if (found) Object.assign(found, fixture);
        else tables.football_fixtures.push({ id: randomUUID(), ...fixture });
      }
      return { data: [counts], error: null };
    }
    if (fn === "feed_insert_forecasts") {
      tables.weather_forecasts ??= [];
      let n = 0;
      for (const r of rows) {
        const same = tables.weather_forecasts.some(
          (f) => f.restaurant_id === r.restaurant_id && f.issued_at === r.issued_at && (r.target_day ? f.target_day === r.target_day : f.hour_start === r.hour_start),
        );
        if (same) continue;
        tables.weather_forecasts.push({ id: randomUUID(), target_day: null, hour_start: null, ...r });
        n++;
      }
      return { data: n, error: null };
    }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  return { data: null, error: { message: `feeds-memory: unknown function ${fn}` } };
}
