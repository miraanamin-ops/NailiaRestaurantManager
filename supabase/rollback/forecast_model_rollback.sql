-- =====================================================================
-- DinerAI: ROLLBACK of 040_forecast_model.sql. Only if you go back to the code
-- from before the forecast model (set ANALYTICS_JOBS to false in Vercel, or
-- revert the forecast-model merge on GitHub, and wait for it to deploy).
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
-- It keeps the model runs and forecasts already written; it deletes the
-- coefficients and drivers tables with their rows, and the calendar's
-- alternative dates for uncertain religious days.
-- =====================================================================

-- 1. The forecast jobs (waiting or finished), then their job types.
delete from jobs where type in ('forecast_daily', 'forecast_refresh');
delete from job_types where type in ('forecast_daily', 'forecast_refresh');

-- 2. The views, then the tables (their policies go with them), then the helper.
drop view if exists analytics.model_coefficients;
drop view if exists analytics.forecast_drivers;
drop table if exists model_coefficients;
drop table if exists forecast_drivers;
drop function if exists ops_run_is_showable(uuid);

-- 3. The calendar view as before 040, then the alternative-date columns.
drop view if exists analytics.calendar;
create view analytics.calendar as
  select id, restaurant_id, day as first_day, coalesce(end_day, day) as last_day, starts_at, ends_at, name, type,
         coalesce(scope, case when restaurant_id is null then 'national' else 'restaurant' end) as scope,
         region, council_code, latitude, longitude, venue_id, expected_size, date_uncertain, source
    from local_calendar;
grant select on analytics.calendar to analytics_reader;
drop trigger if exists local_calendar_alt_day on local_calendar;
drop function if exists ops_calendar_alt_day();
alter table local_calendar drop column if exists alt_probability;
alter table local_calendar drop column if exists alt_day;

delete from schema_migrations where name = '040_forecast_model.sql';
