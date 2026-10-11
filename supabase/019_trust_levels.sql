-- =====================================================================
-- DinerAI agent organisation, phase 1: the release gate's new rules
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Trust level per task: {"review_reply": "approve", ...}. Missing = Approve.
--    Only the builder changes it (settings page, builder controls). Campaigns,
--    offers, hours, menu and profile changes can never be Auto (enforced in code).
alter table restaurants add column if not exists trust_levels jsonb not null default '{}'::jsonb;

-- 2. New reasons the gate can stop a send:
--    trust_level   the task is Draft only
--    test_mode     test mode is on and this would reach a real platform or customer
--    weekly_limit  everyone in the segment already had a campaign in the last 7 days
alter table blocked_sends drop constraint if exists blocked_sends_reason_check;
alter table blocked_sends add constraint blocked_sends_reason_check
  check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window', 'no_recipients', 'trust_level', 'test_mode', 'weekly_limit'));

insert into schema_migrations (name) values ('019_trust_levels.sql') on conflict (name) do nothing;
