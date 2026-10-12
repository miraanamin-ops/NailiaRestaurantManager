-- =====================================================================
-- DinerAI agent organisation, phase 2: the Reputation agent
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Shadow drafts: what an agent would have written, next to what the owner
--    actually got, with the checker's verdict. The /log comparison reads these.
create table if not exists shadow_drafts (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  agent            text not null,                 -- 'reputation'
  agent_version    text,
  checker_version  text,
  job_id           uuid references agent_jobs(id) on delete set null,
  source           text not null,                 -- 'review_check' or 'pasted'
  review_id        uuid references reviews(id) on delete set null,
  review           jsonb not null,                -- the review as it was: author, rating, text
  legacy_draft_id  uuid references drafts(id) on delete set null,
  legacy_text      text,                          -- what today's assistant wrote
  outcome          text not null,                 -- 'reply' or 'question'
  output           jsonb not null,                -- the agent's final draft (JSON)
  question         text,                          -- when the owner would have been asked instead
  checker          jsonb,                         -- the checker's last verdict
  revisions        int not null default 0,
  steps            jsonb,                         -- each step: agent, version, verdict, summary
  profile_version  int,
  created_at       timestamptz not null default now()
);
create index if not exists shadow_drafts_restaurant_idx on shadow_drafts (restaurant_id, created_at desc);
alter table shadow_drafts enable row level security;

-- 2. A question for the owner about a review (e.g. it alleges food poisoning),
--    with the buttons Reply publicly / Handle privately / Both. It's a draft
--    so it uses the approval loop and the brief, but the gate never sends it.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question'));
-- A question is "answered" once the owner taps one of its buttons.
alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check
  check (status in ('pending', 'approved', 'queued', 'sent', 'blocked', 'skipped', 'superseded', 'rejected', 'withdrawn', 'answered'));
-- What an agent needs to pick a draft up again later (e.g. the review a question is about).
alter table drafts add column if not exists agent_input jsonb;

-- 3. Reputation's weekly themes (what customers praised and complained about),
--    one row per restaurant per week, used by the Monday report.
create table if not exists review_themes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  week_start     date not null,                   -- the Monday the week starts on (London)
  praise         jsonb not null default '[]'::jsonb,      -- [{ label, count, review_ids }]
  complaints     jsonb not null default '[]'::jsonb,
  review_count   int not null default 0,
  agent_version  text,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, week_start)
);
alter table review_themes enable row level security;

-- 4. The go-live checklist's WhatsApp prompt to the owner goes at most once a day.
alter table restaurants add column if not exists pilot_prompted_at timestamptz;

insert into schema_migrations (name) values ('020_reputation.sql') on conflict (name) do nothing;
