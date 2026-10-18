-- =====================================================================
-- DinerAI: the demand forecast model (analytics/service, forecast_daily)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things). Run it
-- BEFORE turning on ANALYTICS_JOBS in Vercel with the new code.
--
--   1. Two external job types: forecast_daily (05:35 UK, re-fit and forecast)
--      and forecast_refresh (07:00 UK, days 0 to 2 again with the latest
--      weather and calendar, no re-fit).
--   2. model_coefficients: every run's weights, so we can see them change.
--   3. forecast_drivers: the biggest reasons behind each daily forecast, so
--      the app can explain them.
--   Both are append-only, tied to their run (and deleted with it), and an
--   owner login only ever sees rows of a production run that succeeded and
--   passed its back-test (the same rule the app uses for forecasts).
--   4. Uncertain religious dates (Ramadan, Eid by moon sighting): the other
--      possible day (alt_day) and, if known, how likely it is
--      (alt_probability). The forecast blends the two days, 50/50 when no
--      probability is recorded. Filled from the notes the generator writes
--      ("Alternative dates: 2026-03-21"): now, and for rows added later.
-- =====================================================================

-- 1. Job types. Heartbeats extend the lock, so a long run keeps it; a crashed
--    worker's job is picked up again once the lock runs out.
insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('forecast_daily', 'external', 4, 3, 300,
   'Nightly 05:35 UK: the demand forecast (re-fit on all history, 56 days daily and 14 days hourly, back-tested); Python service'),
  ('forecast_refresh', 'external', 4, 3, 180,
   '07:00 UK: the demand forecast for days 0 to 2 again with the latest weather and calendar, no re-fit; Python service')
on conflict (type) do nothing;

-- 2. Coefficients: one row per run, channel and factor. estimate and sd are on
--    the log scale (exp(estimate) is the multiplier); prior_mean and prior_sd
--    are the defaults it was shrunk towards.
create table if not exists model_coefficients (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  model_run_id   uuid not null,
  channel        text not null check (channel in ('all', 'dine_in', 'takeaway', 'delivery')),
  factor         text not null,
  estimate       double precision not null,
  sd             double precision,
  prior_mean     double precision,
  prior_sd       double precision,
  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade
);
create index if not exists model_coefficients_run_idx on model_coefficients (model_run_id);
create index if not exists model_coefficients_lookup_idx on model_coefficients (restaurant_id, factor, issued_at desc);

-- 3. Drivers: for each daily forecast, its biggest contributions (weekday,
--    season, Eid, rain...) as multipliers (1.25 = 25% more orders than without it).
create table if not exists forecast_drivers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  model_run_id   uuid not null,
  target_day     date not null,
  channel        text not null check (channel in ('all', 'dine_in', 'takeaway', 'delivery')),
  factor         text not null,
  multiplier     double precision not null check (multiplier > 0),
  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade
);
create index if not exists forecast_drivers_run_idx on forecast_drivers (model_run_id);
create index if not exists forecast_drivers_lookup_idx on forecast_drivers (restaurant_id, target_day, channel, issued_at desc);

-- 4. RLS (030): owners read their own rows; model_writer may only add rows.
select ops_apply_policies('model_coefficients', 'output');
select ops_apply_policies('forecast_drivers', 'output');

-- Owner logins see only rows of a production run that succeeded and passed
-- (src/lib/ops/model-roles.ts isShowableRun, here in the database as well).
-- Restrictive, and named without ops_, so ops_apply_policies never removes it.
create or replace function ops_run_is_showable(p_run_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from model_runs where id = p_run_id and role = 'production' and status = 'succeeded' and passed is true)
$$;
revoke all on function ops_run_is_showable(uuid) from public;
grant execute on function ops_run_is_showable(uuid) to authenticated;

drop policy if exists only_showable_runs on model_coefficients;
create policy only_showable_runs on model_coefficients as restrictive for select to authenticated using (ops_run_is_showable(model_run_id));
drop policy if exists only_showable_runs on forecast_drivers;
create policy only_showable_runs on forecast_drivers as restrictive for select to authenticated using (ops_run_is_showable(model_run_id));

-- 5. The analytics views (the 07:00 refresh reads the 05:35 run's coefficients).
create or replace view analytics.model_coefficients as
  select id, restaurant_id, model_run_id, channel, factor, estimate, sd, prior_mean, prior_sd, issued_at from model_coefficients;
create or replace view analytics.forecast_drivers as
  select id, restaurant_id, model_run_id, target_day, channel, factor, multiplier, issued_at from forecast_drivers;

-- 6. Uncertain religious dates: the alternative day and its probability.
alter table local_calendar add column if not exists alt_day date;
alter table local_calendar add column if not exists alt_probability numeric(4, 3) check (alt_probability between 0 and 1);
-- Rows added or changed later get theirs from the notes too (when nobody set it).
create or replace function ops_calendar_alt_day() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.date_uncertain and new.alt_day is null and new.notes ~ '\d{4}-\d{2}-\d{2}' then
    new.alt_day := substring(new.notes from '(\d{4}-\d{2}-\d{2})')::date;
  end if;
  return new;
end;
$$;
drop trigger if exists local_calendar_alt_day on local_calendar;
create trigger local_calendar_alt_day before insert or update on local_calendar
  for each row execute function ops_calendar_alt_day();
update local_calendar
   set alt_day = substring(notes from '(\d{4}-\d{2}-\d{2})')::date
 where date_uncertain and alt_day is null and notes ~ '\d{4}-\d{2}-\d{2}';

-- New columns at the end, so the view can be replaced.
create or replace view analytics.calendar as
  select id, restaurant_id, day as first_day, coalesce(end_day, day) as last_day, starts_at, ends_at, name, type,
         coalesce(scope, case when restaurant_id is null then 'national' else 'restaurant' end) as scope,
         region, council_code, latitude, longitude, venue_id, expected_size, date_uncertain, source,
         alt_day, alt_probability
    from local_calendar;

revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to analytics_reader;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema analytics from anon, authenticated;
    revoke all on model_coefficients, forecast_drivers from anon;
  end if;
end $$;

insert into schema_migrations (name) values ('040_forecast_model.sql') on conflict (name) do nothing;
