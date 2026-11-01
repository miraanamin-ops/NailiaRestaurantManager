-- 056: Pilot Zero (docs/pilot-zero.md). The builder goes through DinerAI as the
-- first real customer; everything here is off unless a restaurant is marked.
--   pilot_zero             the builder's own pilot restaurant (marked in the admin
--                          console, /onboarding/admin/pilot-zero; only a test
--                          restaurant or one on the builder's own number can be)
--   google_dry_run         Google review replies and posts: true = dry run (shown
--                          as "would have posted", nothing reaches Google), false
--                          = they go to Google, empty = dry run for a Pilot Zero
--                          restaurant, live for everyone else
--   google_profile_writes  hours and photos: for a Pilot Zero restaurant they stay
--                          dry run until this is true (and replies are live too)
-- All three are set only by the builder in the admin console, never by the owner,
-- WhatsApp, Dina or a profile edit (src/lib/gate-rules.ts googleDryRun).
--
-- The simulation (phase 3, src/lib/simulation.ts): while a Pilot Zero restaurant
-- has a simulated clock (restaurants.fake_now), real scheduled jobs skip it and
-- "Run day" in the admin console runs them for the simulated date.
--   reviews.simulated, sales_days.simulated, sales_hours.simulated
--                          what the simulation injected (also is_dummy for sales),
--                          so it can be filtered out or cleared
--   job type sim_day       Run day, one try (it alerts the builder if it dies)
--
--   restaurants.simulation when the simulation started and what Stop puts back
--
-- Closing an account (phase 5, src/lib/closure.ts; admin console only):
--   account_closures       one row per closure. While it's pending it points at
--                          the restaurant; once closed the restaurant is gone and
--                          the row is the one anonymous line kept (a reference,
--                          the kind, the dates, the counts: no name, email or number)
--   bucket account-exports the owner's export (CSV and JSON), private, deleted
--                          after 7 days by the daily clean-up
--   job type account_close the closing itself (export, email, Google, Stripe, delete)
--
-- The Pilot Zero log (phase 6, src/lib/pilot-notes.ts):
--   pilot_notes            "#note ..." from the builder's WhatsApp, with the
--                          simulated date (or the real one); CSV from the admin console
--
-- Only adds things, so the code before it keeps working. Safe to re-run.

alter table restaurants add column if not exists pilot_zero boolean not null default false;
alter table restaurants add column if not exists google_dry_run boolean;
alter table restaurants add column if not exists google_profile_writes boolean;
alter table restaurants add column if not exists simulation jsonb; -- when it started, and the once-a-day markers to put back on Stop

alter table reviews add column if not exists simulated boolean not null default false;
alter table sales_days add column if not exists simulated boolean not null default false;
alter table sales_hours add column if not exists simulated boolean not null default false;

insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('sim_day', 'app', 1, 1, 600, 'Pilot Zero: Run day, every scheduled job for a simulated date (admin console)'),
  ('account_close', 'app', 1, 3, 600, 'Closing an account: export, email, Google, Stripe, then delete everything (admin console)')
on conflict (type) do nothing;

create table if not exists account_closures (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,                 -- "CL-7F3K2Q", the anonymous reference
  restaurant_id      uuid references restaurants(id) on delete set null,
  kind               text not null check (kind in ('demo', 'pilot_zero', 'real')),
  status             text not null default 'requested' check (status in ('requested', 'scheduled', 'closing', 'closed', 'cancelled', 'failed')),
  requested_at       timestamptz not null default now(),
  confirmed_at       timestamptz,
  closes_at          timestamptz,                          -- after the 24-hour cooling-off (or at once, if skipped)
  skipped_cooling_off boolean not null default false,
  paused_before      boolean,                              -- put back if it's cancelled
  cancelled_at       timestamptz,
  closed_at          timestamptz,
  export_paths       jsonb,                                -- files in account-exports
  export_expires_at  timestamptz,
  export_deleted_at  timestamptz,
  steps              jsonb not null default '{}'::jsonb,   -- what each step did (export, email, google, stripe, deleted)
  counts             jsonb,                                -- rows and files removed, by table
  last_error         text
);
create index if not exists account_closures_due_idx on account_closures (closes_at) where status = 'scheduled';
-- At most one pending closure per restaurant.
create unique index if not exists account_closures_one_pending on account_closures (restaurant_id) where status in ('requested', 'scheduled', 'closing');
alter table account_closures enable row level security;

insert into storage.buckets (id, name, public)
values ('account-exports', 'account-exports', false)
on conflict (id) do nothing;

create table if not exists pilot_notes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references restaurants(id) on delete set null, -- the builder's restaurant then, if any
  day            date not null,                                      -- the simulated date, or the real one
  simulated      boolean not null default false,
  note           text not null,
  message_sid    text unique,                                        -- Twilio's id: a repeat delivery is noted once
  created_at     timestamptz not null default now()
);
alter table pilot_notes enable row level security;

insert into schema_migrations (name) values ('056_pilot_zero.sql') on conflict (name) do nothing;
