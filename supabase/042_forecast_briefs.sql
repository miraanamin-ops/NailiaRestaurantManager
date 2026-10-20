-- =====================================================================
-- DinerAI: showing the forecast to owners (slice 1, src/lib/forecast/).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- Run it BEFORE deploying the new code.
--
--   1. forecast_briefs: one row per restaurant per day, what the 9am brief
--      showed about the forecast (the run it used, the rounded ranges, the
--      days-ahead flags, the quiet-night offer and what happened to it). The
--      next day's "Yesterday" line and the Monday report compare against it,
--      and /log shows it to the builder. The forecast tables are unchanged.
--   2. restaurants.forecast_unvalidated: the builder's demo-only setting to
--      show forecasts from runs that didn't pass (labelled TEST). The database
--      refuses it on a real restaurant; the app also needs TEST_TOOLS on.
-- =====================================================================

-- 1. What each morning brief showed.
create table if not exists forecast_briefs (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  day              date not null,                       -- the London day of the brief
  status           text not null check (status in ('shown', 'no_forecast', 'none')),
  reason           text,                                -- why not shown (for the builder)
  run_id           uuid,                                -- the model run used (no foreign key: runs are output data)
  run_name         text,                                -- forecast_daily (05:35) or forecast_refresh (07:00)
  unvalidated      boolean not null default false,      -- shown under the demo override (TEST)
  orders_low       numeric(14, 2),                      -- today's ranges as shown (rounded)
  orders_likely    numeric(14, 2),
  orders_high      numeric(14, 2),
  sales_likely     numeric(14, 2),                      -- pence, before VAT, rounded
  block            text,                                -- the lines the owner saw
  flags            jsonb not null default '[]'::jsonb,  -- days-ahead flags: [{day, kind, pct, reason}]
  offer            jsonb,                               -- {day, status: offered|blocked|drafted|declined, draft_id, ...}
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (restaurant_id, day)
);
create index if not exists forecast_briefs_lookup_idx on forecast_briefs (restaurant_id, day desc);

-- Owners may read their own rows; only the app (secret key) writes.
alter table forecast_briefs enable row level security;
drop policy if exists ops_read on forecast_briefs;
create policy ops_read on forecast_briefs for select to authenticated using (ops_owns_restaurant(restaurant_id));
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on forecast_briefs from anon;
  end if;
end $$;

-- 2. The demo-only override.
alter table restaurants add column if not exists forecast_unvalidated boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_forecast_unvalidated_demo_only') then
    alter table restaurants add constraint restaurants_forecast_unvalidated_demo_only check (not forecast_unvalidated or coalesce(is_demo, false));
  end if;
end $$;

insert into schema_migrations (name) values ('042_forecast_briefs.sql') on conflict (name) do nothing;
