-- =====================================================================
-- DinerAI agent organisation, phase 1: agent jobs
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Every piece of agent work is a job with a unique key, so a retry never
--    does the same work twice (e.g. "checker:<draft id>:v2").
create table if not exists agent_jobs (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  job_key        text not null unique,
  agent          text not null,               -- 'checker', 'reputation', ...
  kind           text not null,               -- what the job does, e.g. 'checker_shadow'
  trigger        text not null,               -- what started it, e.g. 'draft_created'
  draft_id       uuid references drafts(id) on delete cascade,
  status         text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts       int not null default 0,
  locked_until   timestamptz,                 -- a running job whose lock has passed is picked up again
  input          jsonb,
  output         jsonb,
  agent_version  text,
  verdict        text,
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index if not exists agent_jobs_queue_idx on agent_jobs (restaurant_id, status, created_at);
create index if not exists agent_jobs_draft_idx on agent_jobs (draft_id);
alter table agent_jobs enable row level security;

-- 2. The audit log says which job, agent and version did something, and its verdict.
alter table audit_log add column if not exists job_id        uuid references agent_jobs(id) on delete set null;
alter table audit_log add column if not exists agent         text;
alter table audit_log add column if not exists agent_version text;
alter table audit_log add column if not exists verdict       text;

-- 3. Shadow mode: the checker agent's verdict on a draft, kept next to the
--    existing four checks (drafts.checks), which still decide what the owner sees.
alter table drafts add column if not exists agent_check jsonb;

-- 4. Each agent's mode per restaurant: off, shadow or live. Missing = the
--    agent's default (the checker: shadow). Only the builder changes it.
alter table restaurants add column if not exists agent_modes jsonb not null default '{}'::jsonb;

insert into schema_migrations (name) values ('017_agent_jobs.sql') on conflict (name) do nothing;
