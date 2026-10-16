-- =====================================================================
-- DinerAI operations data, part 6 of 8: model runs and their outputs
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
-- Outputs are never overwritten: a new run adds rows, and readers take the
-- latest issued_at. The Python service (model_writer) may add rows to the
-- output tables and finish its own runs with finish_model_run; it can't change
-- or delete anything else.
-- =====================================================================

-- 1. Model runs: one per model per restaurant per run.
create table if not exists model_runs (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  model_name       text not null,                        -- "sales_forecast"
  model_version    text not null,                        -- "0.3.1"
  kind             text not null check (kind in ('forecast', 'rota', 'menu', 'finance', 'deal', 'other')),
  status           text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'superseded')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  data_from        date,                                 -- the data window it learned from
  data_to          date,
  data_cutoff      timestamptz,                          -- it only used what was known by then
  backtest_metric  text,                                 -- "MAPE", "WAPE"...
  backtest_score   numeric(12, 4),
  passed           boolean,                              -- did the back-test clear the bar to be used?
  metrics          jsonb,
  params           jsonb,
  job_id           uuid references jobs(id) on delete set null,
  source           ops_source not null default 'model',
  created_at       timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index if not exists model_runs_idx on model_runs (restaurant_id, kind, started_at desc);

-- Finishing a run: the only change model_writer can make to an existing row, and
-- only to a run that's still running (status, finished_at, metrics, score, passed).
create or replace function finish_model_run(p_run_id uuid, p_status text, p_metrics jsonb default null,
                                            p_backtest_score numeric default null, p_passed boolean default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'finish_model_run: status must be succeeded or failed';
  end if;
  update model_runs
     set status = p_status, finished_at = now(), metrics = coalesce(p_metrics, metrics),
         backtest_score = coalesce(p_backtest_score, backtest_score), passed = coalesce(p_passed, passed)
   where id = p_run_id and status = 'running';
  return found;
end;
$$;

-- 2. Forecasts: low, likely and high for a day (hour_start empty) or an hour.
--    metric sales_pence is in pence; covers and orders are counts.
create table if not exists forecasts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  model_run_id   uuid not null,
  target_day     date not null,                          -- London trading day
  hour_start     timestamptz,                            -- UTC start of the hour; empty = the whole day
  local_hour     smallint check (local_hour between 0 and 23),  -- London hour of hour_start
  metric         text not null check (metric in ('sales_pence', 'covers', 'orders')),
  channel        text not null default 'all' check (channel in ('all', 'dine_in', 'takeaway', 'delivery')),
  low            numeric(14, 2) not null,
  likely         numeric(14, 2) not null,
  high           numeric(14, 2) not null,
  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade,
  check (low <= likely and likely <= high),
  check ((hour_start is null) = (local_hour is null))
);
create index if not exists forecasts_lookup_idx on forecasts (restaurant_id, target_day, metric, channel, issued_at desc);
create index if not exists forecasts_run_idx on forecasts (model_run_id);

-- 3. Suggested rotas for a rota week, with their cost, and their shifts.
create table if not exists suggested_rotas (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references restaurants(id) on delete cascade,
  model_run_id          uuid not null,
  rota_week_id          uuid not null,
  total_cost_pence      bigint not null check (total_cost_pence >= 0),
  labour_pct            numeric(6, 2),
  forecast_sales_pence  bigint,
  notes                 jsonb,                           -- why: rules met, gaps, trade-offs
  issued_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade,
  foreign key (rota_week_id, restaurant_id) references rota_weeks (id, restaurant_id) on delete cascade
);
create index if not exists suggested_rotas_week_idx on suggested_rotas (rota_week_id, issued_at desc);

create table if not exists suggested_rota_shifts (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  suggested_rota_id  uuid not null,
  staff_id           uuid,                               -- empty = needs someone
  role               text not null,
  business_date      date not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  break_minutes      int not null default 0 check (break_minutes >= 0),
  cost_pence         bigint check (cost_pence >= 0),
  created_at         timestamptz not null default now(),
  foreign key (suggested_rota_id, restaurant_id) references suggested_rotas (id, restaurant_id) on delete cascade,
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id) on delete cascade,
  check (ends_at > starts_at)
);
create index if not exists suggested_rota_shifts_idx on suggested_rota_shifts (suggested_rota_id);

-- 4. Menu analysis per dish per period (menu engineering).
create table if not exists menu_analysis (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references restaurants(id) on delete cascade,
  model_run_id           uuid not null,
  dish_id                uuid not null,
  period_start           date not null,
  period_end             date not null,
  units_sold             numeric(12, 2),
  sales_pence            bigint,
  food_cost_pence        bigint,
  margin_pence           bigint,
  popularity_index       numeric(8, 3),
  margin_index           numeric(8, 3),
  category               text check (category in ('star', 'plowhorse', 'puzzle', 'dog')),
  suggestion             text,
  suggested_price_pence  int check (suggested_price_pence >= 0),
  issued_at              timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade,
  foreign key (dish_id, restaurant_id) references dishes (id, restaurant_id) on delete cascade,
  check (period_end >= period_start)
);
create index if not exists menu_analysis_idx on menu_analysis (restaurant_id, period_start, dish_id, issued_at desc);

-- 5. Weekly finance snapshots (Monday's date). Percentages as 28.50 = 28.5%.
--    lines: the P&L lines, e.g. [{"line": "Rent", "pence": 120000}].
create table if not exists finance_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  model_run_id       uuid,
  week_start         date not null check (extract(isodow from week_start) = 1),
  sales_pence        bigint,
  labour_cost_pence  bigint,
  food_cost_pence    bigint,
  fixed_costs_pence  bigint,
  labour_pct         numeric(6, 2),
  food_cost_pct      numeric(6, 2),
  prime_cost_pct     numeric(6, 2),
  lines              jsonb not null default '[]'::jsonb,
  data_quality       jsonb,                              -- what was missing or estimated
  issued_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade
);
create index if not exists finance_snapshots_idx on finance_snapshots (restaurant_id, week_start, issued_at desc);

-- 6. Deal outcomes can name the run that measured them (033).
alter table deal_outcomes drop constraint if exists deal_outcomes_model_run_fkey;
alter table deal_outcomes add constraint deal_outcomes_model_run_fkey
  foreign key (model_run_id, restaurant_id) references model_runs (id, restaurant_id) on delete cascade;

-- 7. RLS (030): owners read their own; model_writer may add rows.
select ops_apply_policies('model_runs', 'output');
select ops_apply_policies('forecasts', 'output');
select ops_apply_policies('suggested_rotas', 'output');
select ops_apply_policies('suggested_rota_shifts', 'output');
select ops_apply_policies('menu_analysis', 'output');
select ops_apply_policies('finance_snapshots', 'output');

revoke all on function finish_model_run(uuid, text, jsonb, numeric, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function finish_model_run(uuid, text, jsonb, numeric, boolean) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function finish_model_run(uuid, text, jsonb, numeric, boolean) to service_role;
  end if;
end $$;
grant execute on function finish_model_run(uuid, text, jsonb, numeric, boolean) to model_writer;

insert into schema_migrations (name) values ('035_ops_models.sql') on conflict (name) do nothing;
