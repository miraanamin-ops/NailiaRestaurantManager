-- =====================================================================
-- Naila step 10: safety tidy-up
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. The four checks each draft went through (tone, facts, compliance,
--    money and risk), with what each one fixed or flagged.
alter table drafts add column if not exists checks jsonb;

-- Drafts can be "withdrawn": sent, then taken back with UNDO (e.g. a review
-- reply removed again in dummy Google mode).
alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check
  check (status in ('pending', 'approved', 'queued', 'sent', 'blocked', 'skipped', 'superseded', 'rejected', 'withdrawn'));

-- 2. One log of every action, with who did it and when. UNDO uses it.
create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references restaurants(id) on delete cascade,
  draft_id       uuid references drafts(id) on delete set null,
  batch_id       uuid,                    -- actions taken together (e.g. APPROVE ALL)
  actor          text not null,           -- 'owner', 'safety rules', 'hourly job', 'morning job', ...
  action         text not null,           -- 'created', 'edited', 'approved', 'skipped', 'blocked', 'queued', 'sent', 'undone', 'setting' ...
  detail         text,                    -- one line, in plain English
  data           jsonb,                   -- what's needed to undo it (e.g. the previous value)
  undone_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_restaurant_idx on audit_log (restaurant_id, created_at desc);
alter table audit_log enable row level security;

-- Google posts can be taken down again with UNDO.
alter table google_posts add column if not exists withdrawn_at timestamptz;

-- 3. Every scheduled job run with its real outcome, and alerts to the builder.
create table if not exists job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,               -- 'hourly' or 'daily'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'failed')),
  summary      jsonb,
  error        text
);
create index if not exists job_runs_job_idx on job_runs (job, started_at desc);
alter table job_runs enable row level security;

create table if not exists builder_alerts (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,               -- the same problem only alerts once every few hours
  message     text not null,
  channels    text,                        -- e.g. 'email ok, whatsapp ok'
  created_at  timestamptz not null default now()
);
create index if not exists builder_alerts_key_idx on builder_alerts (key, created_at desc);
alter table builder_alerts enable row level security;

-- A review is only marked handled once its reply draft exists. While a check is
-- drafting it, it's "claimed"; a claim older than 15 minutes is retried.
alter table reviews add column if not exists claimed_at timestamptz;

-- 4. Report links expire after 30 days.
alter table reports add column if not exists expires_at timestamptz;
update reports set expires_at = created_at + interval '30 days' where expires_at is null;

-- 5. Demo restaurants: everything belonging to them is dummy data that
--    scripts/clear-dummy-data.mjs can clear in one go.
alter table restaurants add column if not exists is_demo boolean not null default false;
update restaurants set is_demo = true where id = '11111111-1111-1111-1111-111111111111';

insert into schema_migrations (name) values ('011_safety_tidy_up.sql') on conflict (name) do nothing;
