-- =====================================================================
-- DinerAI: the outside data feeds (src/lib/feeds/) that fill the tables the
-- forecast model reads: weather, the calendar (religious and cultural dates,
-- school holidays, football and cricket, local events, disruption, paydays,
-- clock changes) and prayer times.
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things and
-- redefines three analytics views; their columns only grow at the end).
-- Run it BEFORE deploying the new code, and before the analytics service
-- with the cricket change (it reads analytics.football_fixtures.sport).
--
--   1. 'builder' as a source.
--   2. The feeds' job types and their status table (feed_status).
--   3. Restaurants: the religious authority they follow, and their weather cell.
--   4. Weather forecasts: the weather model's own run time, and never changed
--      once saved (an update is refused).
--   5. The calendar: authority, who confirmed an uncertain date, when a feed
--      fetched it; fixtures get a sport (football or cricket); venues get a
--      Ticketmaster id and a typical crowd; councils and their school dates.
--   6. Writing feed rows without duplicates (feed_upsert_calendar,
--      feed_upsert_fixtures): one row per (feed, external id), and a date the
--      builder confirmed is never changed back by a feed.
--   7. The analytics views:
--      calendar       every row that applies to a restaurant, not just its own
--                     (shared rows were invisible to the model before: the
--                     service reads "restaurant_id = this restaurant")
--      prayer_times   a mosque timetable wins on the days it covers
--      football_fixtures  with the sport
--   8. Seeds: the three councils the generator knows, with their term dates.
-- =====================================================================

-- 1. 'builder' as a source (rows the builder entered or confirmed).
alter domain ops_source drop constraint if exists ops_source_check;
alter domain ops_source add constraint ops_source_check
  check (value in ('photo', 'export', 'manual', 'owner_message', 'assumed', 'feed', 'synthetic', 'model', 'migrated', 'builder'));

-- 2. Job types (the app's own workers run them; lib/queue/handlers.ts).
insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('feed_weather',     'app', 2, 4, 300, 'Daily 04:30 and 06:45 UK: weather actuals and forecasts as issued, one job per weather cell (Open-Meteo)'),
  ('feed_calendar',    'app', 1, 4, 300, 'Daily 04:30 UK: bank holidays, religious and cultural dates, paydays, clock changes'),
  ('feed_prayer',      'app', 3, 3, 300, 'Daily 04:30 UK: prayer times for the next 60 days, one job per restaurant'),
  ('feed_football',    'app', 1, 4, 180, 'Daily 04:30 UK: football fixtures for the next 60 days (football-data.org, 10 calls a minute)'),
  ('feed_events',      'app', 1, 4, 300, 'Daily 04:30 UK: events within 5 km, one job per restaurant (Ticketmaster)'),
  ('feed_disruption',  'app', 1, 4, 180, 'Daily 04:30 UK: tube and rail strikes and closures (TfL)'),
  ('feed_terms_check', 'app', 1, 2, 120, 'Daily 04:30 UK: every active restaurant''s council has school dates for the next 4 months'),
  ('feed_backfill',    'app', 2, 4, 300, 'A restaurant''s outside data for its sales history (weather, prayer times, calendar)')
on conflict (type) do nothing;

-- Each feed's switch and health. The builder turns a feed off on /feeds (no
-- redeploy); fresh_hours: the watchdog alerts the builder when the last success
-- is older (empty = not watched).
create table if not exists feed_status (
  feed             text primary key,
  enabled          boolean not null default true,
  fresh_hours      int check (fresh_hours > 0),
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_outcome     text check (last_outcome in ('ok', 'skipped', 'failed')),
  last_error       text,
  last_rows        jsonb,                                  -- {"weather_hours": 120, ...} on the last success
  last_detail      jsonb,                                  -- why it skipped, what it covered
  next_run_at      timestamptz,
  alerted_at       timestamptz,
  updated_at       timestamptz not null default now()
);
alter table feed_status enable row level security;
insert into feed_status (feed, fresh_hours) values
  ('weather', 26), ('calendar', 50), ('prayer', 50), ('football', 50), ('events', 50), ('disruption', 50), ('school_terms', 50),
  ('backfill', null)
on conflict (feed) do nothing;

-- 3. Restaurants.
alter table restaurants add column if not exists religious_authority text not null default 'east-london-mosque';
alter table restaurants drop constraint if exists restaurants_religious_authority_check;
alter table restaurants add constraint restaurants_religious_authority_check
  check (religious_authority in ('east-london-mosque', 'uk-moonsighting'));
-- The weather grid cell ("51.50,0.00"): restaurants in one cell share one fetch.
alter table restaurants add column if not exists weather_cell text;
-- When the outside data for its sales history was last filled (empty = the
-- hourly run queues a backfill; a new address or an older POS import queues one too).
alter table restaurants add column if not exists outside_backfilled_at timestamptz;

-- 4. Weather forecasts as issued: never changed once saved.
alter table weather_forecasts add column if not exists model_run_at timestamptz;  -- the weather model's own run (Open-Meteo metadata)
create or replace function weather_forecasts_frozen() returns trigger
language plpgsql as $$
begin
  raise exception 'Weather forecasts are kept exactly as issued: add a new forecast instead of changing one';
end;
$$;
drop trigger if exists weather_forecasts_frozen on weather_forecasts;
create trigger weather_forecasts_frozen before update on weather_forecasts
  for each row execute function weather_forecasts_frozen();

-- 5. The calendar.
alter table local_calendar add column if not exists authority    text;           -- whose dates (religious rows): east-london-mosque, uk-moonsighting
alter table local_calendar add column if not exists confirmed_at timestamptz;    -- an uncertain date confirmed (feeds never change it again)
alter table local_calendar add column if not exists confirmed_by text;
alter table local_calendar add column if not exists fetched_at   timestamptz;    -- when a feed last fetched it
create index if not exists local_calendar_type_idx on local_calendar (type, day);
-- One date per name per day stays the rule for rows typed in by hand; a feed's
-- rows are kept apart by their external id instead (two events can share a
-- name on a day: two venues, two authorities' Eid).
drop index if exists local_calendar_one_per_day;
create unique index if not exists local_calendar_one_per_day_manual
  on local_calendar (coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), day, name) where external_id is null;

alter table football_fixtures add column if not exists sport text not null default 'football';
alter table football_fixtures drop constraint if exists football_fixtures_sport_check;
alter table football_fixtures add constraint football_fixtures_sport_check check (sport in ('football', 'cricket'));
alter table football_fixtures add column if not exists fetched_at timestamptz;

alter table venues add column if not exists ticketmaster_id text;
alter table venues add column if not exists typical_crowd int check (typical_crowd > 0);  -- people at a usual event (else capacity)
create unique index if not exists venues_ticketmaster_idx on venues (ticketmaster_id) where ticketmaster_id is not null;

alter table prayer_times add column if not exists fetched_at timestamptz;

-- Councils (school holidays and inset days are per local authority, by ONS code).
create table if not exists councils (
  code               text primary key,                     -- ONS code, e.g. E09000026
  name               text not null,
  term_dates_url     text,                                 -- where the builder found the dates
  dates_known_until  date,                                 -- the last day the saved term dates cover
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
select ops_apply_policies('councils', 'global');

-- School dates as the council publishes them: terms (with their half term) and
-- inset days. The holidays in local_calendar are worked out from these
-- (src/lib/feeds/school-terms.ts). Every row is confirmed by the builder.
create table if not exists school_dates (
  id               uuid primary key default gen_random_uuid(),
  council_code     text not null references councils(code) on delete cascade,
  kind             text not null check (kind in ('term', 'inset')),
  start_day        date not null,
  end_day          date not null,
  half_term_start  date,
  half_term_end    date,
  academic_year    text not null,                          -- '2026-27'
  notes            text,
  source           ops_source not null default 'builder',
  confirmed_by     text,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  check (end_day >= start_day),
  check ((half_term_start is null) = (half_term_end is null)),
  check (half_term_end is null or half_term_end >= half_term_start)
);
create unique index if not exists school_dates_idx on school_dates (council_code, kind, start_day);
select ops_apply_policies('school_dates', 'global');

-- Dates Claude read from a council page, waiting for the builder to confirm
-- each row (nothing reaches school_dates until then).
create table if not exists school_date_drafts (
  id            uuid primary key default gen_random_uuid(),
  council_code  text not null references councils(code) on delete cascade,
  url           text not null,
  rows          jsonb not null default '[]',                -- [{kind, start_day, end_day, half_term_start, half_term_end, academic_year, notes}]
  notes         text,                                      -- what Claude couldn't read
  created_at    timestamptz not null default now()
);
alter table school_date_drafts enable row level security;

-- 6. Writing feed rows. Every row carries external_source + external_id, so a
--    re-run updates the row instead of adding one. A confirmed row (the builder
--    confirmed its date) keeps its dates. Returns how many were added, changed
--    and kept as confirmed.
create or replace function feed_upsert_calendar(p_rows jsonb)
returns table (inserted int, updated int, kept int)
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_id uuid;
  v_n int;
  v_confirmed boolean;
begin
  inserted := 0; updated := 0; kept := 0;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    if coalesce(r ->> 'external_source', '') = '' or coalesce(r ->> 'external_id', '') = '' then
      raise exception 'feed_upsert_calendar: every row needs external_source and external_id';
    end if;
    select id, confirmed_at is not null into v_id, v_confirmed from local_calendar
     where external_source = r ->> 'external_source' and external_id = r ->> 'external_id';
    if v_id is null then
      insert into local_calendar (restaurant_id, day, end_day, starts_at, ends_at, name, type, scope, region, council_code,
                                  latitude, longitude, venue_id, expected_size, date_uncertain, alt_day, alt_probability,
                                  authority, notes, source, external_source, external_id, fetched_at)
      values ((r ->> 'restaurant_id')::uuid, (r ->> 'day')::date, (r ->> 'end_day')::date, (r ->> 'starts_at')::timestamptz,
              (r ->> 'ends_at')::timestamptz, r ->> 'name', r ->> 'type', r ->> 'scope', r ->> 'region', r ->> 'council_code',
              (r ->> 'latitude')::numeric, (r ->> 'longitude')::numeric, (r ->> 'venue_id')::uuid, (r ->> 'expected_size')::int,
              coalesce((r ->> 'date_uncertain')::boolean, false), (r ->> 'alt_day')::date, (r ->> 'alt_probability')::numeric,
              r ->> 'authority', r ->> 'notes', coalesce(r ->> 'source', 'feed'), r ->> 'external_source', r ->> 'external_id',
              coalesce((r ->> 'fetched_at')::timestamptz, now()));
      inserted := inserted + 1;
    elsif v_confirmed then
      update local_calendar set fetched_at = coalesce((r ->> 'fetched_at')::timestamptz, now()) where id = v_id;
      kept := kept + 1;
    else
      update local_calendar set
        restaurant_id = (r ->> 'restaurant_id')::uuid, day = (r ->> 'day')::date, end_day = (r ->> 'end_day')::date,
        starts_at = (r ->> 'starts_at')::timestamptz, ends_at = (r ->> 'ends_at')::timestamptz, name = r ->> 'name',
        type = r ->> 'type', scope = r ->> 'scope', region = r ->> 'region', council_code = r ->> 'council_code',
        latitude = (r ->> 'latitude')::numeric, longitude = (r ->> 'longitude')::numeric, venue_id = (r ->> 'venue_id')::uuid,
        expected_size = (r ->> 'expected_size')::int, date_uncertain = coalesce((r ->> 'date_uncertain')::boolean, false),
        alt_day = (r ->> 'alt_day')::date, alt_probability = (r ->> 'alt_probability')::numeric, authority = r ->> 'authority',
        notes = r ->> 'notes', source = coalesce(r ->> 'source', 'feed'),
        fetched_at = coalesce((r ->> 'fetched_at')::timestamptz, now()), updated_at = now()
       where id = v_id
         and (day, end_day, starts_at, ends_at, name, type, scope, region, council_code, latitude, longitude, venue_id,
              expected_size, date_uncertain, alt_day, alt_probability, authority, notes)
             is distinct from
             ((r ->> 'day')::date, (r ->> 'end_day')::date, (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz,
              r ->> 'name', r ->> 'type', r ->> 'scope', r ->> 'region', r ->> 'council_code', (r ->> 'latitude')::numeric,
              (r ->> 'longitude')::numeric, (r ->> 'venue_id')::uuid, (r ->> 'expected_size')::int,
              coalesce((r ->> 'date_uncertain')::boolean, false), (r ->> 'alt_day')::date, (r ->> 'alt_probability')::numeric,
              r ->> 'authority', r ->> 'notes');
      get diagnostics v_n = row_count;
      if v_n > 0 then updated := updated + 1; else
        update local_calendar set fetched_at = coalesce((r ->> 'fetched_at')::timestamptz, now()) where id = v_id;
      end if;
    end if;
  end loop;
  return next;
end;
$$;

-- A match: its calendar row (type football, or sport for cricket) and its
-- fixture, both keyed by the feed's id. Row fields as feed_upsert_calendar,
-- plus sport, competition, home_team, away_team, kickoff_at.
create or replace function feed_upsert_fixtures(p_rows jsonb)
returns table (inserted int, updated int, kept int)
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  c record;
  v_event uuid;
begin
  select * into c from feed_upsert_calendar(p_rows);
  inserted := c.inserted; updated := c.updated; kept := c.kept;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    select id into v_event from local_calendar where external_source = r ->> 'external_source' and external_id = r ->> 'external_id';
    insert into football_fixtures (event_id, sport, competition, home_team, away_team, kickoff_at, venue_id, external_source, external_id, source, fetched_at)
    values (v_event, coalesce(r ->> 'sport', 'football'), r ->> 'competition', r ->> 'home_team', r ->> 'away_team',
            (r ->> 'kickoff_at')::timestamptz, (r ->> 'venue_id')::uuid, r ->> 'external_source', r ->> 'external_id',
            coalesce(r ->> 'source', 'feed'), coalesce((r ->> 'fetched_at')::timestamptz, now()))
    on conflict (event_id) do update set
      sport = excluded.sport, competition = excluded.competition, home_team = excluded.home_team, away_team = excluded.away_team,
      kickoff_at = excluded.kickoff_at, venue_id = excluded.venue_id, external_source = excluded.external_source,
      external_id = excluded.external_id, source = excluded.source, fetched_at = excluded.fetched_at;
  end loop;
  return next;
end;
$$;

-- Forecasts as issued: add the rows, skip any already saved (same restaurant,
-- day or hour, and issue time), never change one. Returns how many were added.
create or replace function feed_insert_forecasts(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  insert into weather_forecasts (restaurant_id, issued_at, target_day, hour_start, temp_max, temp_min, temp, rain_mm, rain_chance,
                                 weather_code, sunshine_min, sunshine_hours, provider, source, model_run_at)
  select (r ->> 'restaurant_id')::uuid, (r ->> 'issued_at')::timestamptz, (r ->> 'target_day')::date, (r ->> 'hour_start')::timestamptz,
         (r ->> 'temp_max')::numeric, (r ->> 'temp_min')::numeric, (r ->> 'temp')::numeric, (r ->> 'rain_mm')::numeric,
         (r ->> 'rain_chance')::smallint, (r ->> 'weather_code')::smallint, (r ->> 'sunshine_min')::smallint,
         (r ->> 'sunshine_hours')::numeric, coalesce(r ->> 'provider', 'open-meteo'), coalesce(r ->> 'source', 'feed'),
         (r ->> 'model_run_at')::timestamptz
    from jsonb_array_elements(coalesce(p_rows, '[]')) r
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['feed_upsert_calendar(jsonb)', 'feed_upsert_fixtures(jsonb)', 'feed_insert_forecasts(jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- Bank holidays added before this file (syncBankHolidays) get the feed's key,
-- so the calendar feed updates them instead of adding them again.
update local_calendar c set external_source = 'gov.uk', external_id = 'england-and-wales:' || c.day::text
  from (select distinct on (day) id from local_calendar
         where source = 'gov.uk' and restaurant_id is null and external_id is null and type = 'bank_holiday'
         order by day, created_at) first_of_day
 where c.id = first_of_day.id
   and not exists (select 1 from local_calendar x where x.external_source = 'gov.uk' and x.external_id = 'england-and-wales:' || c.day::text);

-- 7. (The views keep their columns, apart from the fixtures' sport, so an older
--    file run again still works; run this one again after it.)
-- Which calendar rows apply to a restaurant: its own rows, plus shared rows:
--   national   everyone (a row with an authority only for restaurants following it)
--   regional   its nation, or London for a London borough (ONS code E09...)
--   council    its council (school holidays, inset days)
--   local      nearby: a calendar_relevance row the builder hasn't marked "not relevant"
-- The analytics view has the rule in it (a view runs with its owner's rights, so
-- the analytics service needs no access to calendar_relevance itself); the app
-- reads it through restaurant_calendar, and lib/feeds/scope.ts is its copy in code.
create or replace view analytics.calendar as
  select c.id, r.id as restaurant_id, c.day as first_day, coalesce(c.end_day, c.day) as last_day, c.starts_at, c.ends_at, c.name, c.type,
         coalesce(c.scope, case when c.restaurant_id is null then 'national' else 'restaurant' end) as scope,
         c.region, c.council_code, c.latitude, c.longitude, c.venue_id, c.expected_size, c.date_uncertain, c.source,
         c.alt_day, c.alt_probability
    from local_calendar c
    join restaurants r on c.restaurant_id = r.id
      or (c.restaurant_id is null and (
            (coalesce(c.scope, 'national') = 'national' and (c.authority is null or c.authority = r.religious_authority))
         or (c.scope = 'regional' and (lower(c.region) = lower(coalesce(r.nation, 'england'))
                                       or (lower(c.region) = 'london' and coalesce(r.council_code, '') like 'E09%')))
         or (c.scope = 'council' and c.council_code = r.council_code)
         or (c.scope = 'local' and exists (select 1 from calendar_relevance cr
                                            where cr.event_id = c.id and cr.restaurant_id = r.id and cr.relevant is not false))));

-- One restaurant's calendar between two days (rows overlapping them).
create or replace function restaurant_calendar(p_restaurant_id uuid, p_from date, p_to date)
returns setof local_calendar
language sql stable security definer set search_path = public as $$
  select c.* from local_calendar c
   where c.id in (select v.id from analytics.calendar v where v.restaurant_id = p_restaurant_id)
     and c.day <= p_to and coalesce(c.end_day, c.day) >= p_from
   order by c.day, c.name
$$;
revoke all on function restaurant_calendar(uuid, date, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function restaurant_calendar(uuid, date, date) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function restaurant_calendar(uuid, date, date) to service_role;
  end if;
end $$;
-- An earlier draft of this file had the rule as a function; it isn't used any more.
drop function if exists ops_calendar_applies(local_calendar, restaurants);

-- Prayer times: on a day a mosque timetable covers (method 'timetable:<mosque>'),
-- the restaurant uses the timetable; on other days, its calculated times.
create or replace view analytics.prayer_times as
  select p.restaurant_id, p.day, p.fajr, p.sunrise, p.dhuhr, p.asr, p.maghrib, p.isha,
         p.fajr as sehri_ends, p.maghrib as iftar, p.method,
         case when exists (select 1 from prayer_times t where t.restaurant_id = p.restaurant_id and t.day = p.day and t.method like 'timetable:%')
              then p.method like 'timetable:%'
              else p.method = case when r.prayer_method like 'computed:%' then r.prayer_method else 'computed:moonsighting_committee+hanafi' end
         end as restaurant_uses
    from prayer_times p join restaurants r on r.id = p.restaurant_id;

create or replace view analytics.football_fixtures as
  select f.event_id, f.competition, f.home_team, f.away_team, f.kickoff_at, f.venue_id, f.sport from football_fixtures f;

revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to analytics_reader;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema analytics from anon, authenticated;
    revoke all on feed_status, school_date_drafts from anon, authenticated;
  end if;
end $$;

-- 8. Seeds.
-- (The five big venues are added by the events feed, src/lib/feeds/venues.ts,
-- so a database built for the synthetic data keeps only the generator's.)

-- The councils the synthetic data generator has term dates for (their dates are
-- loaded by scripts/seed-school-dates.mjs from analytics/generator/synth/outside/data).
insert into councils (code, name, term_dates_url) values
  ('E09000026', 'Redbridge', 'https://www.redbridge.gov.uk/schools/school-holidays-and-term-dates'),
  ('E09000025', 'Newham', 'https://www.newham.gov.uk/downloads/file/7864/school-term-and-holiday-dates-2025-2026'),
  ('E09000031', 'Waltham Forest', 'https://www.walthamforest.gov.uk/schools-education-and-learning/school-term-and-closure-dates/school-holiday-and-term-dates')
on conflict (code) do nothing;
-- Their terms, as the generator has them (analytics/generator/synth/outside/data/school_terms.json;
-- Newham's autumn 2026 is the London pattern, its own wasn't published yet). The
-- holidays in local_calendar are made from these by the calendar feed.
insert into school_dates (council_code, kind, start_day, end_day, half_term_start, half_term_end, academic_year, source, confirmed_by, confirmed_at) values
('E09000026', 'term', '2024-09-02', '2024-12-20', '2024-10-28', '2024-11-01', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2025-01-06', '2025-04-04', '2025-02-17', '2025-02-21', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2025-04-22', '2025-07-22', '2025-05-26', '2025-05-30', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2025-09-01', '2025-12-19', '2025-10-27', '2025-10-31', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2026-01-05', '2026-03-27', '2026-02-16', '2026-02-20', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2026-04-13', '2026-07-20', '2026-05-25', '2026-05-29', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000026', 'term', '2026-09-02', '2026-12-18', '2026-10-26', '2026-10-30', '2026-27', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2024-09-02', '2024-12-20', '2024-10-28', '2024-11-01', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2025-01-06', '2025-04-04', '2025-02-17', '2025-02-21', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2025-04-22', '2025-07-23', '2025-05-26', '2025-05-30', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2025-09-01', '2025-12-19', '2025-10-27', '2025-10-31', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2026-01-05', '2026-03-27', '2026-02-16', '2026-02-20', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2026-04-13', '2026-07-22', '2026-05-25', '2026-05-29', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000025', 'term', '2026-09-02', '2026-12-18', '2026-10-26', '2026-10-30', '2026-27', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2024-09-02', '2024-12-19', '2024-10-21', '2024-10-25', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2025-01-06', '2025-04-04', '2025-02-17', '2025-02-21', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2025-04-22', '2025-07-23', '2025-05-27', '2025-05-30', '2024-25', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2025-09-01', '2025-12-19', '2025-10-27', '2025-10-31', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2026-01-05', '2026-03-27', '2026-02-16', '2026-02-20', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2026-04-13', '2026-07-20', '2026-05-26', '2026-05-29', '2025-26', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z'),
  ('E09000031', 'term', '2026-09-02', '2026-12-18', '2026-10-26', '2026-10-30', '2026-27', 'builder', 'builder (synthetic data generator, checked 2026-10-17)', '2026-10-17T00:00:00Z')
on conflict (council_code, kind, start_day) do nothing;
update councils c set dates_known_until = (select max(end_day) from school_dates d where d.council_code = c.code and d.kind = 'term')
 where dates_known_until is null;

insert into schema_migrations (name) values ('041_outside_feeds.sql') on conflict (name) do nothing;
