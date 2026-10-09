-- =====================================================================
-- Naila step 9: housekeeping
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- 1. A record of which of these database files have been run.
--    From now on every file ends by adding its own name here, and
--    scripts/check-schema.mjs compares this list with the supabase/ folder.
create table if not exists schema_migrations (
  name        text primary key,          -- the file name, e.g. '009_housekeeping.sql'
  applied_at  timestamptz not null default now()
);
alter table schema_migrations enable row level security;

-- Files 001-008 were run by hand before this table existed.
insert into schema_migrations (name) values
  ('setup.sql'),
  ('002_messages.sql'),
  ('003_approval_loop.sql'),
  ('004_safety_rules.sql'),
  ('005_customer_signups.sql'),
  ('006_email_campaigns.sql'),
  ('007_google.sql'),
  ('007b_hourly_schedule.sql'),
  ('008_brief_report.sql')
on conflict (name) do nothing;

-- 2. Twilio can deliver the same WhatsApp message twice: each incoming
--    message ID may only be logged (and acted on) once.
create unique index if not exists messages_inbound_sid_once
  on messages (twilio_sid) where direction = 'inbound' and twilio_sid is not null;

-- 3. The morning job: a short lock so two runs can't overlap, and a count of
--    failed attempts today (it retries each hour, then gives up after 3).
alter table restaurants add column if not exists morning_lock_until  timestamptz;
alter table restaurants add column if not exists morning_failures    int not null default 0;
alter table restaurants add column if not exists morning_failed_on   date;

-- 4. The "birthday" draft type was never used (birthday emails are email campaigns).
--    (The unused drafts.reminded_at column is removed by 010, after the new code is live.)
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post'));

insert into schema_migrations (name) values ('009_housekeeping.sql') on conflict (name) do nothing;
