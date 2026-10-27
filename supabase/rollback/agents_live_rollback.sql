-- =====================================================================
-- DinerAI: ROLLBACK of 047_agents_live.sql. Only if you go back to the code
-- from before the agents went live: revert that commit first, and put every
-- restaurant back on the old assistant (node --env-file=.env.local
-- scripts/assistant-mode.mjs <restaurant> old). Paste this into Supabase >
-- SQL Editor and click "Run". Safe to run twice.
--
-- Blocks saved with the two newer reasons are deleted (the old list can't hold them).
-- =====================================================================

begin;

delete from blocked_sends where reason in ('checker', 'google_error');
alter table blocked_sends drop constraint if exists blocked_sends_reason_check;
alter table blocked_sends add constraint blocked_sends_reason_check
  check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window', 'no_recipients', 'trust_level', 'test_mode', 'weekly_limit', 'scheduled'));
delete from schema_migrations where name = '047_agents_live.sql';

commit;
