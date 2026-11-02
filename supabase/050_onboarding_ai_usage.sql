-- =====================================================================
-- DinerAI: what onboarding with Dina costs (phase 3).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
-- One row per Claude call made while a restaurant sets up (Dina's turns, the
-- step router, and later menu reading and the like), with its tokens and its
-- estimated cost in US dollars. A "run" is one onboarding from its start
-- (onboarding_sessions.started_at), so a test site that's reset and run again
-- counts as a new run. scripts/onboarding-costs.mjs adds them up.
-- Only the app's server reads and writes it (Row Level Security on, no policies).
-- =====================================================================

create table if not exists onboarding_ai_usage (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  run_started_at  timestamptz not null,
  step_key        text,
  purpose         text not null check (purpose in ('turn', 'router', 'extract')),
  model           text not null,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cache_read      int not null default 0,
  cache_write     int not null default 0,
  cost_usd        numeric(10, 6) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists onboarding_ai_usage_run_idx on onboarding_ai_usage (restaurant_id, run_started_at);
alter table onboarding_ai_usage enable row level security;

insert into schema_migrations (name) values ('050_onboarding_ai_usage.sql') on conflict (name) do nothing;
