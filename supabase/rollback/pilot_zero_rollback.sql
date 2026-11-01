-- Undoes 056_pilot_zero.sql. Only once no code reads these columns (the code
-- before 056 doesn't). Without them nothing is dry run: check first that no
-- restaurant has a real Google profile linked that should stay dry run.

delete from jobs where type = 'sim_day';
delete from job_types where type = 'sim_day';
-- Simulated rows go too (they were only ever test data).
delete from reviews where simulated;
delete from sales_hours where simulated;
delete from sales_days where simulated;
alter table sales_hours drop column if exists simulated;
alter table sales_days drop column if exists simulated;
alter table reviews drop column if exists simulated;
alter table restaurants drop column if exists simulation;
alter table restaurants drop column if exists google_profile_writes;
alter table restaurants drop column if exists google_dry_run;
alter table restaurants drop column if exists pilot_zero;

delete from schema_migrations where name = '056_pilot_zero.sql';
