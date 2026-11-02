-- 055: each restaurant's week forecast, saved once a day (src/lib/forecast/snapshot.ts).
-- The brief, the Monday report and the rota all read the same saved copy, so they
-- can never show different numbers for the same day (before this, each worked the
-- forecast out again, so a forecast run or a sales upload landing in between could
-- change it). The report's "Last week" reads the copy saved last Monday: what the
-- owner was actually told.
--   week_start  the Monday of the week forecast
--   made_on     the London day it was worked out (one copy per week per day)
--   data        the whole week as the app shows it (WeekAhead, lib/forecast/week-ahead-rules.ts)
-- Safe to re-run. Rollback: supabase/rollback/forecast_snapshots_rollback.sql.

create table if not exists forecast_snapshots (
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  week_start     date not null,
  made_on        date not null,
  data           jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (restaurant_id, week_start, made_on)
);

alter table forecast_snapshots enable row level security;
drop policy if exists ops_read on forecast_snapshots;
create policy ops_read on forecast_snapshots for select to authenticated using (ops_owns_restaurant(restaurant_id));

insert into schema_migrations (name) values ('055_forecast_snapshots.sql') on conflict (name) do nothing;
