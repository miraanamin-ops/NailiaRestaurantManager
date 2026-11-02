-- =====================================================================
-- DinerAI: onboarding with Dina, the foundation (docs/onboarding-audit.md).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things; today's
-- onboarding keeps using its own `onboarding` table).
--
--   1. onboarding_sessions: one per restaurant (the "site") going through Dina's
--      setup: where they are, the channel they used last, when they finished.
--      account_id is empty until accounts exist.
--   2. onboarding_steps: one row per restaurant per step, with its status and
--      the data saved for it. The steps, their order and the rules are in code
--      (src/lib/onboarding/flow.ts); Dina can only save through checked tools.
--   3. onboarding_messages: the setup conversation, so switching between the web
--      chat and WhatsApp carries on with the same chat.
--   4. setup_gaps: a skipped or half-done step, what it unlocks, and its nudges.
--   5. Test sites: restaurants.is_test (always a demo restaurant too). Code keeps
--      them from emailing customers or writing to Google, whatever the switches say.
--   6. The privacy notice and data processing agreement versions accepted at
--      sign-up (the terms version is already saved, from 025).
--   7. Invite codes get a type: standard or pilot.
--
-- Owners can read their own rows (Row Level Security); only the app's server
-- writes. Deleting a restaurant deletes all of it.
-- =====================================================================

-- 1. Sessions.
create table if not exists onboarding_sessions (
  restaurant_id               uuid primary key references restaurants(id) on delete cascade,
  account_id                  uuid,                          -- for accounts, later
  flow_version                int not null default 2,        -- 2 = Dina (1 was the step-by-step wizard)
  current_step                text,                          -- the step Dina is on (null once all are done)
  channel_last_used           text check (channel_last_used in ('web', 'whatsapp')),
  started_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  abandoned_reminder_sent_at  timestamptz,                   -- the one "carry on where we left off"
  stall_alerted_at            timestamptz,                   -- the builder was told it stalled
  updated_at                  timestamptz not null default now()
);

-- 2. Steps.
create table if not exists onboarding_steps (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  step_key       text not null,
  status         text not null default 'not_started'
                 check (status in ('not_started', 'in_progress', 'done', 'partial', 'skipped')),
  data           jsonb not null default '{}'::jsonb,
  waiting_on     text,                                         -- in progress but waiting on something else, e.g. 'google_acceptance'
  started_at     timestamptz,
  completed_at   timestamptz,
  skipped_at     timestamptz,
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, step_key)
);

-- 3. The conversation.
create table if not exists onboarding_messages (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  role           text not null check (role in ('dina', 'owner', 'system')),
  channel        text not null check (channel in ('web', 'whatsapp')),
  step_key       text,
  body           text not null default '',
  parts          jsonb not null default '[]'::jsonb,           -- buttons, cards, uploads (the web chat draws them)
  external_id    text,                                         -- e.g. the Twilio message id, so a repeat delivery is saved once
  created_at     timestamptz not null default now()
);
create index if not exists onboarding_messages_chat_idx on onboarding_messages (restaurant_id, created_at);
create unique index if not exists onboarding_messages_external_idx on onboarding_messages (restaurant_id, external_id) where external_id is not null;

-- 4. Setup gaps.
create table if not exists setup_gaps (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  step_key          text not null,
  unlock_text       text not null,
  nudge_count       int not null default 0,
  last_nudged_at    timestamptz,
  snoozed_until     timestamptz,
  dismissed         boolean not null default false,
  dismissed_reason  text check (dismissed_reason in ('not_relevant', 'ignored')),
  resolved_at       timestamptz,                               -- the step was finished later
  created_at        timestamptz not null default now(),
  unique (restaurant_id, step_key)
);

do $$
declare t text;
begin
  foreach t in array array['onboarding_sessions', 'onboarding_steps', 'onboarding_messages', 'setup_gaps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ops_read on %I', t);
    execute format('create policy ops_read on %I for select to authenticated using (ops_owns_restaurant(restaurant_id))', t);
  end loop;
end $$;

-- 5. Test sites.
alter table restaurants add column if not exists is_test boolean not null default false;
alter table restaurants drop constraint if exists restaurants_test_is_demo;
alter table restaurants add constraint restaurants_test_is_demo check (not is_test or is_demo);

-- 6. What was accepted at sign-up.
alter table restaurants add column if not exists privacy_version text;
alter table restaurants add column if not exists dpa_version text;

-- 7. Invite code types.
alter table pilot_invites add column if not exists type text not null default 'pilot';
alter table pilot_invites drop constraint if exists pilot_invites_type_check;
alter table pilot_invites add constraint pilot_invites_type_check check (type in ('standard', 'pilot'));

insert into schema_migrations (name) values ('048_onboarding_dina.sql') on conflict (name) do nothing;
