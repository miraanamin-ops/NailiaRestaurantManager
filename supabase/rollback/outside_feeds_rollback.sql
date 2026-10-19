-- =====================================================================
-- DinerAI: ROLLBACK of 041_outside_feeds.sql. Only if you go back to the code
-- from before the outside data feeds (revert the outside-feeds merge on GitHub
-- and wait for it to deploy), and before that, the analytics service from
-- before the cricket change (it reads analytics.football_fixtures.sport).
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
--
-- It keeps the weather, prayer times and calendar rows the feeds wrote (they
-- are ordinary rows the old code reads too), apart from cricket matches (the
-- old model would read them as football). It deletes the feeds' status, the
-- councils and their school dates, and the columns 041 added.
-- =====================================================================

begin;

-- 1. The feeds' jobs (waiting or finished), then their job types.
delete from jobs where type like 'feed\_%';
delete from job_types where type like 'feed\_%';

-- 2. The views as before 041 (same columns, apart from the fixtures' sport).
create or replace view analytics.calendar as
  select id, restaurant_id, day as first_day, coalesce(end_day, day) as last_day, starts_at, ends_at, name, type,
         coalesce(scope, case when restaurant_id is null then 'national' else 'restaurant' end) as scope,
         region, council_code, latitude, longitude, venue_id, expected_size, date_uncertain, source,
         alt_day, alt_probability
    from local_calendar;
create or replace view analytics.prayer_times as
  select p.restaurant_id, p.day, p.fajr, p.sunrise, p.dhuhr, p.asr, p.maghrib, p.isha,
         p.fajr as sehri_ends, p.maghrib as iftar, p.method, p.method = r.prayer_method as restaurant_uses
    from prayer_times p join restaurants r on r.id = p.restaurant_id;
drop view if exists analytics.football_fixtures;
create view analytics.football_fixtures as
  select f.event_id, f.competition, f.home_team, f.away_team, f.kickoff_at, f.venue_id from football_fixtures f;
grant select on analytics.football_fixtures to analytics_reader;

-- 3. Functions, the forecast guard, the tables 041 made.
drop function if exists feed_upsert_fixtures(jsonb);
drop function if exists feed_upsert_calendar(jsonb);
drop function if exists feed_insert_forecasts(jsonb);
drop function if exists restaurant_calendar(uuid, date, date);
drop function if exists ops_calendar_applies(local_calendar, restaurants);
drop trigger if exists weather_forecasts_frozen on weather_forecasts;
drop function if exists weather_forecasts_frozen();
drop table if exists school_date_drafts, school_dates, councils, feed_status;

-- 4. Cricket matches, then the columns 041 added.
delete from local_calendar where id in (select event_id from football_fixtures where sport = 'cricket');
alter table football_fixtures drop column if exists sport;
alter table football_fixtures drop column if exists fetched_at;
alter table venues drop column if exists ticketmaster_id;
alter table venues drop column if exists typical_crowd;
alter table prayer_times drop column if exists fetched_at;
alter table weather_forecasts drop column if exists model_run_at;
alter table local_calendar drop column if exists authority;
alter table local_calendar drop column if exists confirmed_at;
alter table local_calendar drop column if exists confirmed_by;
alter table local_calendar drop column if exists fetched_at;
alter table restaurants drop column if exists religious_authority;
alter table restaurants drop column if exists weather_cell;
alter table restaurants drop column if exists outside_backfilled_at;
-- (The calendar's one-date-per-name rule stays as 041 left it: for rows typed in
-- by hand. Feed rows can share a name on a day, so the old index can't come back.)

-- 5. 'builder' as a source: those rows become 'manual', then the old list.
update prayer_times set source = 'manual' where source = 'builder';
update football_fixtures set source = 'manual' where source = 'builder';
update venues set source = 'manual' where source = 'builder';
alter domain ops_source drop constraint if exists ops_source_check;
alter domain ops_source add constraint ops_source_check
  check (value in ('photo', 'export', 'manual', 'owner_message', 'assumed', 'feed', 'synthetic', 'model', 'migrated'));

delete from schema_migrations where name = '041_outside_feeds.sql';

commit;
