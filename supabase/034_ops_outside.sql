-- =====================================================================
-- DinerAI operations data, part 5 of 8: weather, the calendar, prayer times
-- and the restaurant's own events
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things; the
-- calendar's existing readers keep working on `day`).
-- =====================================================================

-- 1. Hourly weather (actuals), next to the existing daily weather_days.
--    Keyed by the UTC start of the hour, so the clock-change hours stay apart.
create table if not exists weather_hours (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  hour_start     timestamptz not null,
  temp           numeric(4, 1),
  rain_mm        numeric(5, 1),
  weather_code   smallint,                               -- WMO code
  cloud_pct      smallint check (cloud_pct between 0 and 100),
  wind_kmh       numeric(5, 1),
  provider       text not null default 'open-meteo',
  source         ops_source not null default 'feed',
  fetched_at     timestamptz not null default now(),
  unique (restaurant_id, hour_start)
);

-- 2. Weather forecasts exactly as issued. Never changed: each fetch adds rows with
--    its issued_at, so a back-test can use only what was known at the time
--    (weather_known_at below). A row is for a day (target_day) or an hour (hour_start).
create table if not exists weather_forecasts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  issued_at      timestamptz not null,                   -- when we fetched it (Open-Meteo has no issue time of its own)
  target_day     date,                                   -- London day
  hour_start     timestamptz,                            -- UTC start of the hour
  temp_max       numeric(4, 1),
  temp_min       numeric(4, 1),
  temp           numeric(4, 1),
  rain_mm        numeric(5, 1),
  rain_chance    smallint check (rain_chance between 0 and 100),
  weather_code   smallint,
  provider       text not null default 'open-meteo',
  source         ops_source not null default 'feed',
  created_at     timestamptz not null default now(),
  check ((target_day is null) <> (hour_start is null))
);
create unique index if not exists weather_forecasts_day_idx on weather_forecasts (restaurant_id, target_day, issued_at) where target_day is not null;
create unique index if not exists weather_forecasts_hour_idx on weather_forecasts (restaurant_id, hour_start, issued_at) where hour_start is not null;

-- The latest forecast for a day (or an hour) issued at or before the cut-off.
create or replace function weather_known_at(p_restaurant_id uuid, p_day date, p_cutoff timestamptz)
returns setof weather_forecasts
language sql stable set search_path = public as $$
  select * from weather_forecasts
   where restaurant_id = p_restaurant_id and target_day = p_day and issued_at <= p_cutoff
   order by issued_at desc limit 1
$$;
create or replace function weather_hour_known_at(p_restaurant_id uuid, p_hour_start timestamptz, p_cutoff timestamptz)
returns setof weather_forecasts
language sql stable set search_path = public as $$
  select * from weather_forecasts
   where restaurant_id = p_restaurant_id and hour_start = p_hour_start and issued_at <= p_cutoff
   order by issued_at desc limit 1
$$;

-- 3. Venues (every restaurant shares them): stadiums, arenas, big halls.
create table if not exists venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('stadium', 'arena', 'concert_hall', 'park', 'other')),
  latitude    numeric(8, 5) not null,
  longitude   numeric(8, 5) not null,
  capacity    int check (capacity > 0),
  teams       text[] not null default '{}',               -- home teams, for fixtures
  source      ops_source not null default 'manual',
  created_at  timestamptz not null default now()
);
create unique index if not exists venues_name_idx on venues (ops_name_key(name));

-- 4. The calendar: local_calendar (023_growth.sql) grows into one calendar of
--    events. Existing rows and readers keep working: `day` is the first day.
--    scope: national, regional (a nation or region), council (one local authority:
--    school holidays, inset days), local (a place, with latitude/longitude), restaurant.
--    Empty scope on old rows: national when restaurant_id is empty, else restaurant.
alter table local_calendar add column if not exists end_day         date;          -- last day (inclusive); empty = one day
alter table local_calendar add column if not exists starts_at       timestamptz;   -- when it starts, if it has a time (kick-off...)
alter table local_calendar add column if not exists ends_at         timestamptz;
alter table local_calendar add column if not exists scope           text;
alter table local_calendar add column if not exists region          text;          -- 'england', 'scotland', 'london'...
alter table local_calendar add column if not exists council_code    text;          -- ONS code, for school holidays
alter table local_calendar add column if not exists latitude        numeric(8, 5);
alter table local_calendar add column if not exists longitude       numeric(8, 5);
alter table local_calendar add column if not exists venue_id        uuid references venues(id) on delete set null;
alter table local_calendar add column if not exists expected_size   int check (expected_size >= 0);  -- people expected
alter table local_calendar add column if not exists external_source text;          -- the feed it came from
alter table local_calendar add column if not exists external_id     text;          -- that feed's id, so a feed never adds it twice
alter table local_calendar add column if not exists notes           text;
alter table local_calendar add column if not exists updated_at      timestamptz not null default now();

alter table local_calendar drop constraint if exists local_calendar_type_check;
alter table local_calendar add constraint local_calendar_type_check
  check (type in ('bank_holiday', 'religious', 'cultural', 'school_holiday', 'inset_day', 'sport', 'football',
                  'local_event', 'disruption', 'payday', 'clock_change'));
alter table local_calendar drop constraint if exists local_calendar_source_check;
alter table local_calendar add constraint local_calendar_source_check
  check (source in ('builder', 'gov.uk', 'feed', 'manual', 'owner_message', 'synthetic'));
alter table local_calendar drop constraint if exists local_calendar_scope_check;
alter table local_calendar add constraint local_calendar_scope_check
  check (scope is null or scope in ('national', 'regional', 'council', 'local', 'restaurant'));
alter table local_calendar drop constraint if exists local_calendar_dates_check;
alter table local_calendar add constraint local_calendar_dates_check
  check ((end_day is null or end_day >= day) and (ends_at is null or starts_at is null or ends_at >= starts_at));
create unique index if not exists local_calendar_external_idx on local_calendar (external_source, external_id) where external_id is not null;
create index if not exists local_calendar_range_idx on local_calendar (day, end_day);

-- Owners read their own events and every shared one (030's helper).
alter table local_calendar enable row level security;
drop policy if exists ops_read on local_calendar;
create policy ops_read on local_calendar for select to authenticated
  using (restaurant_id is null or ops_owns_restaurant(restaurant_id));

-- 5. Football fixtures: the detail of a 'football' calendar event (shared).
create table if not exists football_fixtures (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null unique references local_calendar(id) on delete cascade,
  competition      text,
  home_team        text not null,
  away_team        text not null,
  kickoff_at       timestamptz not null,
  venue_id         uuid references venues(id) on delete set null,
  external_source  text,
  external_id      text,
  source           ops_source not null default 'feed',
  created_at       timestamptz not null default now()
);
create index if not exists football_fixtures_kickoff_idx on football_fixtures (kickoff_at);
create unique index if not exists football_fixtures_external_idx on football_fixtures (external_source, external_id) where external_id is not null;

-- The teams whose matches matter to a restaurant (its customers watch them).
create table if not exists restaurant_teams (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  team           text not null,
  why            text,                                    -- "local club", "big screen on match days"
  source         ops_source not null default 'manual',
  created_at     timestamptz not null default now()
);
create unique index if not exists restaurant_teams_idx on restaurant_teams (restaurant_id, ops_name_key(team));

-- 6. How each calendar event relates to each restaurant: the distance (worked out
--    from the restaurant's and the event's location), and the owner's or builder's
--    say on whether it matters (empty = not decided).
create table if not exists calendar_relevance (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  event_id       uuid not null references local_calendar(id) on delete cascade,
  distance_m     int check (distance_m >= 0),
  relevant       boolean,
  marked_by      text,                                    -- 'owner', 'builder'
  marked_at      timestamptz,
  computed_at    timestamptz,
  source         ops_source not null default 'model',
  created_at     timestamptz not null default now(),
  unique (restaurant_id, event_id)
);

-- Distance in metres between two points (haversine; plenty for "how near").
create or replace function ops_distance_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns int
language sql immutable parallel safe as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null else
    round(2 * 6371000 * asin(sqrt(
      power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
      cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lon2 - lon1)::float8) / 2), 2))))::int end
$$;

-- 7. Prayer times per restaurant and day, stored (not worked out on demand):
--    customers follow a mosque timetable that a formula can't reproduce, and
--    back-tests need the times that were used. Times in UTC. Sehri ends at fajr;
--    iftar is at maghrib. method: 'computed:<method>' or 'timetable:<mosque>'
--    (restaurants.prayer_method says which one the restaurant uses).
create table if not exists prayer_times (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  day            date not null,
  fajr           timestamptz not null,
  sunrise        timestamptz,
  dhuhr          timestamptz not null,
  asr            timestamptz not null,
  maghrib        timestamptz not null,
  isha           timestamptz not null,
  method         text not null,
  source         ops_source not null default 'feed',
  created_at     timestamptz not null default now(),
  unique (restaurant_id, day, method)
);

-- 8. The restaurant's own events: closures, refits, menu or price changes,
--    promotions, short-staffed days. treat_as_unusual tells forecasting to leave
--    that period out of what "normal" looks like.
create table if not exists restaurant_events (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  type              text not null check (type in ('closure', 'partial_closure', 'refit', 'menu_change', 'price_change',
                                                  'promotion', 'short_staffed', 'other')),
  starts_at         timestamptz not null,
  ends_at           timestamptz,                         -- empty = still going / open-ended
  treat_as_unusual  boolean not null default true,
  campaign_id       uuid,
  notes             text,
  source            ops_source not null,
  created_by        text,                                -- 'owner', 'builder', 'system'
  confirmed_at      timestamptz,
  confirmed_by      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (campaign_id, restaurant_id) references campaigns (id, restaurant_id) on delete set null (campaign_id),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists restaurant_events_idx on restaurant_events (restaurant_id, starts_at);

alter table deal_outcomes drop constraint if exists deal_outcomes_restaurant_event_fkey;
alter table deal_outcomes add constraint deal_outcomes_restaurant_event_fkey
  foreign key (restaurant_event_id, restaurant_id) references restaurant_events (id, restaurant_id) on delete cascade;

-- 9. RLS (030).
select ops_apply_policies('weather_hours', 'owned');
select ops_apply_policies('weather_forecasts', 'append');
select ops_apply_policies('venues', 'global');
select ops_apply_policies('football_fixtures', 'global');
select ops_apply_policies('restaurant_teams', 'owned');
select ops_apply_policies('calendar_relevance', 'owned');
select ops_apply_policies('prayer_times', 'append');
select ops_apply_policies('restaurant_events', 'owned');

insert into schema_migrations (name) values ('034_ops_outside.sql') on conflict (name) do nothing;
