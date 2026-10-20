-- =====================================================================
-- DinerAI: ROLLBACK of 042_forecast_briefs.sql. Only if you go back to the
-- code from before slice 1 (the forecast in the brief): revert that merge on
-- GitHub and wait for it to deploy first.
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
--
-- It deletes the record of what each brief showed about the forecast, and the
-- demo-only "show unvalidated forecasts" setting. The forecast itself (040's
-- tables) is untouched.
-- =====================================================================

begin;

drop table if exists forecast_briefs cascade;
alter table restaurants drop constraint if exists restaurants_forecast_unvalidated_demo_only;
alter table restaurants drop column if exists forecast_unvalidated;
delete from schema_migrations where name = '042_forecast_briefs.sql';

commit;
