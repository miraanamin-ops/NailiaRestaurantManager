-- =====================================================================
-- DinerAI pilot sprint: finance forecast, local calendar for owners, Monday
-- report sections (docs/pilot-sprint.md, "Finance forecast and calendar").
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
--   1. restaurants.labour_target_pct: the owner's labour target (% of sales).
--      Empty = not set yet (the owner texts "labour target 30%").
--   2. restaurants.forecast_error_limit_pct: the builder's limit. The week's
--      forecast ranges only show when the back-test's error is at or under it.
--      Empty = the default in code (20%).
--   3. forecast_backtests: each day's back-test of the history forecast (the
--      error, how often the actual fell inside the range, week by week).
--   4. calendar_suggestions: a campaign idea offered under a calendar line in
--      the brief ("Draft an offer" / "Not now"), so each one is offered once.
-- =====================================================================

-- 1 and 2.
alter table restaurants add column if not exists labour_target_pct numeric(4, 1)
  check (labour_target_pct is null or (labour_target_pct > 0 and labour_target_pct < 100));
alter table restaurants add column if not exists forecast_error_limit_pct numeric(4, 1)
  check (forecast_error_limit_pct is null or (forecast_error_limit_pct > 0 and forecast_error_limit_pct <= 100));

-- 3. One back-test per restaurant per method per day.
create table if not exists forecast_backtests (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  method          text not null,                 -- 'history_v1' (lib/forecast/baseline.ts)
  tested_on       date not null,                 -- London day it was run
  weeks           int not null default 0,        -- whole weeks tested
  days            int not null default 0,        -- days with a forecast and actual sales
  error_pct       numeric(6, 1),                 -- sales error (WAPE), %; empty = nothing to test
  range_hit_pct   numeric(5, 1),                 -- days inside the range, %
  details         jsonb,                         -- {"by_week": [{"week_start", "error_pct"}]}
  created_at      timestamptz not null default now(),
  unique (restaurant_id, method, tested_on)
);
create index if not exists forecast_backtests_latest_idx on forecast_backtests (restaurant_id, method, tested_on desc);

alter table forecast_backtests enable row level security;
drop policy if exists ops_read on forecast_backtests;
create policy ops_read on forecast_backtests for select to authenticated using (ops_owns_restaurant(restaurant_id));

-- 4. Campaign ideas under calendar lines.
create table if not exists calendar_suggestions (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  event_key       text not null,                 -- the event and its first day, e.g. 'sport:2026-10-31:West Ham v Fulham'
  day             date not null,                 -- the event's (first) day
  title           text not null,                 -- the calendar line's event
  question        text not null,                 -- what the owner was asked
  request         text not null,                 -- what "Draft an offer" asks the campaign flow for
  status          text not null default 'offered' check (status in ('offered', 'drafted', 'declined')),
  draft_id        uuid references drafts(id) on delete set null,
  offered_on      date not null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (restaurant_id, event_key)
);
create index if not exists calendar_suggestions_open_idx on calendar_suggestions (restaurant_id, status, offered_on desc);

alter table calendar_suggestions enable row level security;
drop policy if exists ops_read on calendar_suggestions;
create policy ops_read on calendar_suggestions for select to authenticated using (ops_owns_restaurant(restaurant_id));

insert into schema_migrations (name) values ('046_finance_calendar.sql') on conflict (name) do nothing;
