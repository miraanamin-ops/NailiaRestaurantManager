-- Undoes 056_pilot_zero.sql. Only once no code reads these columns (the code
-- before 056 doesn't). Without them nothing is dry run: check first that no
-- restaurant has a real Google profile linked that should stay dry run.

alter table restaurants drop column if exists google_profile_writes;
alter table restaurants drop column if exists google_dry_run;
alter table restaurants drop column if exists pilot_zero;

delete from schema_migrations where name = '056_pilot_zero.sql';
