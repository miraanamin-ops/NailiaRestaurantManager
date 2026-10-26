-- =====================================================================
-- DinerAI pilot sprint: the weekly rota suggester (docs/pilot-sprint.md, "Rota suggester").
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
--   1. drafts can be a "rota" (the owner approves it; nothing goes to customers).
--   2. rota_weeks gets what the suggester needs: the owner's edits ("Ali can't
--      do Friday"), the week's summary (cost, labour %, flags), the draft on
--      WhatsApp, and the unguessable link the published rota lives on.
--   3. restaurants.rota_settings: shift lengths and the two warnings
--      (hours a week, rest between shifts). Empty = the defaults in code.
--   4. The Thursday 10am job (job type rota_week).
-- =====================================================================

-- 1. A new kind of draft.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice', 'rota'));

-- 2. The suggester's working on each week.
alter table rota_weeks add column if not exists adjustments jsonb not null default '[]'::jsonb; -- the owner's edits, re-applied on every re-fill
alter table rota_weeks add column if not exists summary     jsonb;                              -- the plan as built: shifts, cost, labour %, flags, basis (the page and the PDF draw it)
alter table rota_weeks add column if not exists draft_id    uuid references drafts(id) on delete set null;
alter table rota_weeks add column if not exists share_token text;                                -- the published rota's link (/rota/<token>)
create unique index if not exists rota_weeks_share_token_idx on rota_weeks (share_token) where share_token is not null;

-- 3. Per-restaurant rota settings, e.g. {"min_shift_hours": 4, "max_shift_hours": 10, "flag_week_hours": 48, "flag_rest_hours": 11}.
alter table restaurants add column if not exists rota_settings jsonb;

-- 4. Thursday 10am: next week's rota, as a draft for the owner.
insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('rota_week', 'app', 5, 3, 300, 'Thursday 10am: next week''s rota suggestion, sent to the owner as a draft')
on conflict (type) do nothing;

insert into schema_migrations (name) values ('045_rota_suggester.sql') on conflict (name) do nothing;
