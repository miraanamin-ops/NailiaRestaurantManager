-- =====================================================================
-- DinerAI agent organisation, phase 1: restaurant profile v1
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Profile fields the Reputation agent and the checker need
--    (docs/profile-schema.md). All empty until the owner fills them in settings.
alter table restaurants add column if not exists sign_off_name      text;   -- "Bilal and the team"
alter table restaurants add column if not exists greeting           text;   -- "Salaam"
alter table restaurants add column if not exists complaint_contact  text;   -- "hello@restaurant.co.uk"
alter table restaurants add column if not exists halal_statement    text;   -- the owner's exact wording
alter table restaurants add column if not exists allergen_statement text;   -- the owner's exact wording
alter table restaurants add column if not exists recovery_offers    jsonb not null default '[]'::jsonb;  -- ["free dessert next visit"]
alter table restaurants add column if not exists words_to_avoid     jsonb not null default '[]'::jsonb;  -- ["cheap", "deal"]
alter table restaurants add column if not exists emoji_allowed      jsonb not null
  default '{"review_replies": 0, "posts": 2, "campaigns": 2}'::jsonb;              -- most emojis per kind of message

-- 2. Every profile change is a new version: field, old and new value, who, evidence, when.
alter table restaurants add column if not exists profile_version int not null default 0;

create table if not exists profile_versions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  version        int not null,
  field          text not null,              -- the profile field, e.g. 'hours', 'sign_off_name'
  section        text not null,              -- 'identity', 'voice', 'facts', ...
  old_value      jsonb,
  new_value      jsonb,
  changed_by     text not null,              -- 'owner', 'builder', 'profile keeper', ...
  evidence       jsonb,                      -- what the change came from (a message, settings, decision ids)
  reverts        uuid references profile_versions(id) on delete set null,  -- set when this change was a Revert
  reverted_at    timestamptz,                -- set when Revert put this change back
  created_at     timestamptz not null default now()
);
create index if not exists profile_versions_restaurant_idx on profile_versions (restaurant_id, created_at desc);
create unique index if not exists profile_versions_one_per_version on profile_versions (restaurant_id, version);
alter table profile_versions enable row level security;

-- 3. Each draft records the profile version it was written with.
alter table drafts add column if not exists profile_version int;

insert into schema_migrations (name) values ('018_profile_v1.sql') on conflict (name) do nothing;
