-- =====================================================================
-- DinerAI: ROLLBACK of 043_pilot_rota.sql. Only if you go back to the code
-- from before the pilot sprint's rota: revert that commit first.
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
--
-- It deletes the rota rules and the weekly hours cap on staff. The rota
-- tables from 032 are untouched.
-- =====================================================================

begin;

drop table if exists rota_rules cascade;
alter table staff drop column if exists max_hours_week;
delete from schema_migrations where name = '043_pilot_rota.sql';

commit;
