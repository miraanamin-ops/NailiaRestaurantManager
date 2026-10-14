-- =====================================================================
-- DinerAI onboarding v2: the review replies the owner picks during setup
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- The profile's `examples` field (docs/profile-schema.md, Learning): for now, the
-- replies the owner picked in "Reply to reviews", one for a good review and one
-- for a bad one. Every review reply follows the matching example.
--   { "review_replies": { "positive": { "review", "reply", "style", "own" }, "negative": { ... } } }
alter table restaurants add column if not exists profile_examples jsonb not null default '{}'::jsonb;

insert into schema_migrations (name) values ('026_onboarding_v2.sql') on conflict (name) do nothing;
