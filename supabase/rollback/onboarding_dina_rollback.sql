-- =====================================================================
-- DinerAI: ROLLBACK of 048_onboarding_dina.sql. Only if you go back to the
-- code from before onboarding with Dina: revert that code first. Paste this
-- into Supabase > SQL Editor and click "Run". Safe to run twice.
--
-- It deletes Dina's setup progress, the setup conversations and the setup
-- gaps, the test-site flag, the accepted privacy and DPA versions and the
-- invite code types. Restaurants themselves stay (test sites become ordinary
-- demo restaurants).
-- =====================================================================

begin;

drop table if exists setup_gaps;
drop table if exists onboarding_messages;
drop table if exists onboarding_steps;
drop table if exists onboarding_sessions;
alter table restaurants drop constraint if exists restaurants_test_is_demo;
alter table restaurants drop column if exists is_test;
alter table restaurants drop column if exists privacy_version;
alter table restaurants drop column if exists dpa_version;
alter table pilot_invites drop constraint if exists pilot_invites_type_check;
alter table pilot_invites drop column if exists type;
delete from schema_migrations where name = '048_onboarding_dina.sql';

commit;

-- 049 (logged in straight after sign-up), if it ran. Only these sessions' limit
-- goes: anyone still logged in from a sign-up then sees every restaurant with
-- their email, so sign them out in Supabase > Authentication first if that matters.
begin;
drop table if exists signup_sessions;
drop index if exists onboarding_pending_whatsapp_idx;
delete from schema_migrations where name = '049_signup_sessions.sql';
commit;
