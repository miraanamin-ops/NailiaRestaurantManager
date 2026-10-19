// supabase/041_outside_feeds.sql on the full migration chain in PGlite: feed rows
// never duplicated, confirmed dates kept, forecasts as issued never changed, the
// calendar each restaurant sees (shared rows by scope), a mosque timetable over
// the calculation, and the sport of a fixture.
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb } from "./support/full-pg";

const A = "a0a0a0a0-0000-0000-0000-000000000001"; // Redbridge, London
const B = "b0b0b0b0-0000-0000-0000-000000000002"; // Waltham Forest, London, follows UK moon sighting
const C = "c0c0c0c0-0000-0000-0000-000000000003"; // outside London

const all = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await all<T>(pg, sql, params))[0];
const upsert = (pg: PGlite, rows: unknown[]) => one<{ inserted: number; updated: number; kept: number }>(pg, "select * from feed_upsert_calendar($1::jsonb)", [JSON.stringify(rows)]);
const seen = async (pg: PGlite, r: string, from = "2026-01-01", to = "2028-12-31") =>
  (await all<{ name: string }>(pg, "select name from analytics.calendar where restaurant_id = $1 and first_day between $2 and $3 order by first_day, name", [r, from, to])).map((x) => x.name);

let pg: PGlite;
beforeAll(async () => {
  pg = await newFullDb();
  await pg.query(
    `insert into restaurants (id, name, council_code, nation, latitude, longitude, religious_authority, prayer_method) values
       ($1, 'A', 'E09000026', 'england', 51.559, 0.07, 'east-london-mosque', null),
       ($2, 'B', 'E09000031', 'england', 51.583, -0.02, 'uk-moonsighting', null),
       ($3, 'C', 'E08000025', 'england', 52.48, -1.9, 'east-london-mosque', null)`,
    [A, B, C],
  );
}, 120_000);

describe("feed rows", () => {
  const eid = { external_source: "rule", external_id: "payday:2026-10-30", day: "2026-10-30", name: "Payday (last working day)", type: "payday", scope: "national" };

  test("a re-run never adds a row twice, and only counts real changes", async () => {
    expect(await upsert(pg, [eid])).toEqual({ inserted: 1, updated: 0, kept: 0 });
    expect(await upsert(pg, [eid])).toEqual({ inserted: 0, updated: 0, kept: 0 });
    expect(await upsert(pg, [{ ...eid, notes: "moved" }])).toEqual({ inserted: 0, updated: 1, kept: 0 });
    expect(await one(pg, "select count(*)::int as n from local_calendar where external_id = 'payday:2026-10-30'")).toEqual({ n: 1 });
    await expect(upsert(pg, [{ ...eid, external_id: "" }])).rejects.toThrow(/external_id/);
  });

  test("a date the builder confirmed is never changed back by a feed", async () => {
    const eid2 = { external_source: "religious", external_id: "east-london-mosque:eid_fitr:1448", day: "2027-03-09", name: "Eid al-Fitr", type: "religious", authority: "east-london-mosque", date_uncertain: true, alt_day: "2027-03-10" };
    await upsert(pg, [eid2]);
    await pg.query("update local_calendar set day = '2027-03-10', date_uncertain = false, alt_day = null, confirmed_at = now(), confirmed_by = 'builder' where external_id = $1", [eid2.external_id]);
    expect(await upsert(pg, [eid2])).toEqual({ inserted: 0, updated: 0, kept: 1 });
    expect(await one(pg, "select day::text, date_uncertain from local_calendar where external_id = $1", [eid2.external_id])).toEqual({ day: "2027-03-10", date_uncertain: false });
  });

  test("two events with one name on one day are fine when a feed keeps them apart; hand-typed ones still can't repeat", async () => {
    await upsert(pg, [
      { external_source: "ticketmaster", external_id: "tm1", day: "2026-11-01", name: "Tribute Night", type: "local_event", scope: "local" },
      { external_source: "ticketmaster", external_id: "tm2", day: "2026-11-01", name: "Tribute Night", type: "local_event", scope: "local" },
    ]);
    await pg.query("insert into local_calendar (restaurant_id, day, name, type) values (null, '2026-12-01', 'Fair', 'local_event')");
    await expect(pg.query("insert into local_calendar (restaurant_id, day, name, type) values (null, '2026-12-01', 'Fair', 'local_event')")).rejects.toThrow();
  });

  test("bank holidays saved before 041 get the feed's key, so the feed updates them", async () => {
    // (041 already ran; a fresh one added now gets its key when the feed writes it.)
    await pg.query("insert into local_calendar (restaurant_id, day, name, type, source) values (null, '2026-12-25', 'Christmas Day', 'bank_holiday', 'gov.uk')");
    const sql = (await import("node:fs")).readFileSync(new URL("../supabase/041_outside_feeds.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    expect(await one(pg, "select external_id from local_calendar where day = '2026-12-25' and type = 'bank_holiday'")).toEqual({ external_id: "england-and-wales:2026-12-25" });
    expect(await upsert(pg, [{ external_source: "gov.uk", external_id: "england-and-wales:2026-12-25", day: "2026-12-25", name: "Christmas Day", type: "bank_holiday", source: "gov.uk" }])).toEqual({ inserted: 0, updated: 0, kept: 0 });
    expect(await one(pg, "select count(*)::int as n from local_calendar where day = '2026-12-25' and type = 'bank_holiday'")).toEqual({ n: 1 });
  });
});

describe("weather forecasts as issued", () => {
  test("are never changed once saved; a new issue is a new row", async () => {
    await pg.query("insert into weather_forecasts (restaurant_id, issued_at, target_day, temp_max) values ($1, '2026-10-19T03:30:00Z', '2026-10-20', 14)", [A]);
    await expect(pg.query("update weather_forecasts set temp_max = 20 where restaurant_id = $1", [A])).rejects.toThrow(/as issued/);
    await expect(pg.query("insert into weather_forecasts (restaurant_id, issued_at, target_day, temp_max) values ($1, '2026-10-19T03:30:00Z', '2026-10-20', 15)", [A])).rejects.toThrow();
    await pg.query("insert into weather_forecasts (restaurant_id, issued_at, target_day, temp_max) values ($1, '2026-10-19T05:45:00Z', '2026-10-20', 15)", [A]);
    expect(await one(pg, "select count(*)::int as n from weather_forecasts where restaurant_id = $1", [A])).toEqual({ n: 2 });
  });

  test("the feed's insert skips an issue already saved (a retry), and adds a new one", async () => {
    const rows = [{ restaurant_id: A, issued_at: "2026-10-20T03:30:00Z", target_day: "2026-10-21", temp_max: 13, sunshine_hours: 4.5, provider: "open-meteo (ecmwf_ifs025)", model_run_at: "2026-10-20T00:00:00Z" },
      { restaurant_id: A, issued_at: "2026-10-20T03:30:00Z", hour_start: "2026-10-21T12:00:00Z", temp: 12, sunshine_min: 30 }];
    expect(await one(pg, "select feed_insert_forecasts($1::jsonb) as n", [JSON.stringify(rows)])).toEqual({ n: 2 });
    expect(await one(pg, "select feed_insert_forecasts($1::jsonb) as n", [JSON.stringify(rows)])).toEqual({ n: 0 });
    expect(await one(pg, "select model_run_at, source from weather_forecasts where restaurant_id = $1 and target_day = '2026-10-21'", [A])).toEqual({ model_run_at: new Date("2026-10-20T00:00:00Z"), source: "feed" });
  });
});

describe("the calendar each restaurant sees", () => {
  beforeAll(async () => {
    await upsert(pg, [
      { external_source: "t", external_id: "national", day: "2027-01-04", name: "National", type: "payday" },
      { external_source: "t", external_id: "elm", day: "2027-01-05", name: "Ramadan ELM", type: "religious", authority: "east-london-mosque" },
      { external_source: "t", external_id: "ukm", day: "2027-01-06", name: "Ramadan UKM", type: "religious", authority: "uk-moonsighting" },
      { external_source: "t", external_id: "london", day: "2027-01-07", name: "Tube strike", type: "disruption", scope: "regional", region: "london" },
      { external_source: "t", external_id: "redbridge", day: "2027-01-08", name: "Redbridge half term", type: "school_holiday", scope: "council", council_code: "E09000026" },
      { external_source: "t", external_id: "local", day: "2027-01-09", name: "Concert near A", type: "local_event", scope: "local" },
      { external_source: "t", external_id: "local2", day: "2027-01-10", name: "Concert A said no to", type: "local_event", scope: "local" },
    ]);
    await pg.query("insert into local_calendar (restaurant_id, day, name, type) values ($1, '2027-01-11', 'B own event', 'local_event')", [B]);
    await pg.query(
      `insert into calendar_relevance (restaurant_id, event_id, distance_m) select $1, id, 1200 from local_calendar where external_id in ('local', 'local2')`,
      [A],
    );
    await pg.query("update calendar_relevance set relevant = false, marked_by = 'builder' where event_id = (select id from local_calendar where external_id = 'local2')");
  });

  test("shared rows by scope, authority and nearness; never another restaurant's own rows", async () => {
    expect(await seen(pg, A, "2027-01-01", "2027-01-31")).toEqual(["National", "Ramadan ELM", "Tube strike", "Redbridge half term", "Concert near A"]);
    expect(await seen(pg, B, "2027-01-01", "2027-01-31")).toEqual(["National", "Ramadan UKM", "Tube strike", "B own event"]);
    expect(await seen(pg, C, "2027-01-01", "2027-01-31")).toEqual(["National", "Ramadan ELM"]);
  });

  test("the app's copy of the rule (lib/feeds/scope.ts) agrees with the database on every row and restaurant", async () => {
    const { calendarApplies } = await import("@/lib/feeds/scope");
    const rows = await all<{ id: string; restaurant_id: string | null; scope: string | null; region: string | null; council_code: string | null; authority: string | null }>(pg, "select id, restaurant_id, scope, region, council_code, authority from local_calendar");
    for (const rid of [A, B, C]) {
      const r = await one<{ id: string; nation: string; council_code: string; religious_authority: string }>(pg, "select id, nation, council_code, religious_authority from restaurants where id = $1", [rid]);
      const near = new Set((await all<{ event_id: string }>(pg, "select event_id from calendar_relevance where restaurant_id = $1 and relevant is not false", [rid])).map((x) => x.event_id));
      const sql = new Set((await all<{ id: string }>(pg, "select id from analytics.calendar where restaurant_id = $1", [rid])).map((x) => x.id));
      for (const row of rows) expect(calendarApplies(row, r, near), `${row.id} for ${rid}`).toBe(sql.has(row.id));
    }
  });

  test("the analytics service's login reads it (the rule needs no rights of its own)", async () => {
    await pg.exec("begin; set local role analytics_reader;");
    try {
      const rows = await all<{ name: string }>(pg, "select name from analytics.calendar where restaurant_id = $1 and first_day between '2027-01-01' and '2027-01-31' order by first_day", [A]);
      expect(rows.map((r) => r.name)).toContain("Concert near A");
      await all(pg, "select count(*) from analytics.prayer_times");
      await all(pg, "select sport from analytics.football_fixtures");
    } finally {
      await pg.exec("rollback;");
    }
  });

  test("restaurant_calendar (the app's reader) uses the same rule", async () => {
    const rows = await all<{ name: string }>(pg, "select name from restaurant_calendar($1, '2027-01-01', '2027-01-31')", [B]);
    expect(rows.map((r) => r.name)).toEqual(["National", "Ramadan UKM", "Tube strike", "B own event"]);
  });
});

describe("prayer times", () => {
  test("a mosque timetable wins on the days it covers; the calculation fills the rest", async () => {
    const row = (day: string, method: string, maghrib: string) =>
      pg.query(
        `insert into prayer_times (restaurant_id, day, fajr, dhuhr, asr, maghrib, isha, method, source) values ($1, $2, $2::date + time '05:00', $2::date + time '12:00', $2::date + time '15:00', $3, $2::date + time '19:00', $4, $5)`,
        [A, day, maghrib, method, method.startsWith("timetable") ? "builder" : "feed"],
      );
    await row("2026-11-01", "computed:moonsighting_committee+hanafi", "2026-11-01T16:30:00Z");
    await row("2026-11-02", "computed:moonsighting_committee+hanafi", "2026-11-02T16:29:00Z");
    await row("2026-11-01", "timetable:East London Mosque", "2026-11-01T16:35:00Z");
    const used = await all(pg, "select day::text, method from analytics.prayer_times where restaurant_id = $1 and restaurant_uses order by day", [A]);
    expect(used).toEqual([
      { day: "2026-11-01", method: "timetable:East London Mosque" },
      { day: "2026-11-02", method: "computed:moonsighting_committee+hanafi" },
    ]);
  });
});

describe("fixtures", () => {
  test("carry their sport, and a re-run updates the same match", async () => {
    const m = {
      external_source: "builder", external_id: "cricket:2026-11-14:India:Pakistan", day: "2026-11-14", starts_at: "2026-11-14T09:30:00Z",
      name: "India v Pakistan", type: "sport", scope: "national", source: "builder",
      sport: "cricket", competition: "T20 World Cup group stage", home_team: "India", away_team: "Pakistan", kickoff_at: "2026-11-14T09:30:00Z",
    };
    await one(pg, "select * from feed_upsert_fixtures($1::jsonb)", [JSON.stringify([m])]);
    await one(pg, "select * from feed_upsert_fixtures($1::jsonb)", [JSON.stringify([{ ...m, competition: "T20 World Cup semi-final" }])]);
    expect(await all(pg, "select sport, competition, home_team from analytics.football_fixtures")).toEqual([{ sport: "cricket", competition: "T20 World Cup semi-final", home_team: "India" }]);
    await expect(pg.query("update football_fixtures set sport = 'rugby'")).rejects.toThrow();
  });
});

describe("the rollback", () => {
  test("undoes 041, keeps the feeds' calendar rows, and 041 then runs again", async () => {
    const db = await newFullDb();
    await db.query("insert into restaurants (id, name) values ($1, 'A')", [A]);
    await db.query("select * from feed_upsert_calendar($1::jsonb)", [JSON.stringify([{ external_source: "rule", external_id: "payday:2027-01-29", day: "2027-01-29", name: "Payday", type: "payday" }])]);
    const fs = await import("node:fs");
    await db.exec(fs.readFileSync(new URL("../supabase/rollback/outside_feeds_rollback.sql", import.meta.url), "utf8"));
    expect(await one(db, "select to_regclass('public.feed_status') as t")).toEqual({ t: null });
    expect(await one(db, "select count(*)::int as n from local_calendar where external_id = 'payday:2027-01-29'")).toEqual({ n: 1 });
    expect(await one(db, "select count(*)::int as n from schema_migrations where name = '041_outside_feeds.sql'")).toEqual({ n: 0 });
    await db.exec(fs.readFileSync(new URL("../supabase/041_outside_feeds.sql", import.meta.url), "utf8"));
    expect(await one(db, "select count(*)::int as n from feed_status")).toEqual({ n: 8 });
  }, 120_000);
});

describe("feed status and seeds", () => {
  test("every feed has a status row, and the councils are seeded with their term dates", async () => {
    expect((await all<{ feed: string }>(pg, "select feed from feed_status order by feed")).map((r) => r.feed)).toEqual([
      "backfill", "calendar", "disruption", "events", "football", "prayer", "school_terms", "weather",
    ]);
    expect(await one(pg, "select count(*)::int as n from school_dates where council_code = 'E09000026' and kind = 'term'")).toEqual({ n: 7 });
    expect(await one(pg, "select dates_known_until::text as d from councils where code = 'E09000026'")).toEqual({ d: "2026-12-18" });
    expect(await one(pg, "select name from councils where code = 'E09000026'")).toEqual({ name: "Redbridge" });
    expect(await one(pg, "select name from schema_migrations where name = '041_outside_feeds.sql'")).toEqual({ name: "041_outside_feeds.sql" });
  });
});
