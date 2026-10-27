-- =====================================================================
-- DinerAI: ROLLBACK of 046_finance_calendar.sql. Only if you go back to the
-- code from before the finance forecast and calendar lines: revert that
-- commit first. Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run twice.
--
-- It deletes the saved back-tests, the calendar campaign ideas and the two
-- settings (the owner's labour target, the builder's error limit). Drafts
-- made from an idea stay.
-- =====================================================================

begin;

drop table if exists calendar_suggestions;
drop table if exists forecast_backtests;
alter table restaurants drop column if exists labour_target_pct;
alter table restaurants drop column if exists forecast_error_limit_pct;
delete from schema_migrations where name = '046_finance_calendar.sql';

commit;
