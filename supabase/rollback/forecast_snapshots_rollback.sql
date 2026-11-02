-- =====================================================================
-- DinerAI: ROLLBACK of 055_forecast_snapshots.sql. Paste this into Supabase >
-- SQL Editor and click "Run". Safe to run twice.
--
-- It deletes the saved week forecasts. The code carries on without them: it
-- works each forecast out live again, as before 055 (so the brief and the report
-- could again differ if a forecast run lands between them).
-- =====================================================================

begin;

drop table if exists forecast_snapshots;
delete from schema_migrations where name = '055_forecast_snapshots.sql';

commit;
