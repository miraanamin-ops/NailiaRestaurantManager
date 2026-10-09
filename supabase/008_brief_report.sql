-- =====================================================================
-- Naila step 8: morning brief and Monday report
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- Restaurant: when the last brief and report went out.
alter table restaurants add column if not exists last_brief_on      date;         -- guard: one scheduled brief a day
alter table restaurants add column if not exists last_brief_at      timestamptz;  -- the brief that APPROVE ALL / APPROVE 2 refer to
alter table restaurants add column if not exists brief_waiting_since timestamptz; -- brief held until the owner messages (WhatsApp 24h rule)
alter table restaurants add column if not exists last_report_on     date;         -- guard: one scheduled report a week

-- Drafts: held for the morning brief, and their number in it.
alter table drafts add column if not exists held_at      timestamptz;  -- made by a scheduled job, waiting for the brief
alter table drafts add column if not exists brief_number int;          -- its number in the latest brief it appeared in
alter table drafts add column if not exists briefed_at   timestamptz;  -- which brief (= restaurants.last_brief_at)
create index if not exists drafts_briefed_idx on drafts (restaurant_id, briefed_at) where briefed_at is not null;

-- Weekly reports: a snapshot of the numbers, behind a private link.
create table if not exists reports (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  token          text not null unique,         -- the secret part of the report link
  period_start   timestamptz not null,         -- "last week"
  period_end     timestamptz not null,
  headline       text not null,                -- the two lines sent on WhatsApp
  data           jsonb not null,               -- every section's numbers, frozen when the report was made
  created_at     timestamptz not null default now()
);
create index if not exists reports_restaurant_idx on reports (restaurant_id, created_at desc);
alter table reports enable row level security;

-- Record that this file has been run (see scripts/check-schema.mjs).
insert into schema_migrations (name) values ('008_brief_report.sql') on conflict (name) do nothing;
