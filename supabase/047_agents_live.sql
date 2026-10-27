-- =====================================================================
-- DinerAI: the five agents live (docs/pilot-sprint.md, "Agents live").
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only allows more values).
--
--   1. Two more reasons a send can be blocked, so they're saved with the rest:
--      'checker' (with the checker live, it didn't pass that version of a Google
--      reply or post) and 'google_error' (Google refused a write: already used
--      by the code, but the old list didn't allow it, so those blocks weren't kept).
--
-- Which agents run live is per restaurant (restaurants.agent_modes, set with
-- scripts/assistant-mode.mjs or on the settings page): nothing here switches one on.
-- =====================================================================

alter table blocked_sends drop constraint if exists blocked_sends_reason_check;
alter table blocked_sends add constraint blocked_sends_reason_check
  check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window', 'no_recipients', 'trust_level', 'test_mode', 'weekly_limit', 'scheduled', 'google_error', 'checker'));

insert into schema_migrations (name) values ('047_agents_live.sql') on conflict (name) do nothing;
