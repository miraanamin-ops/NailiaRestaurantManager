-- Undoes 056_pilot_zero.sql. Only once no code reads these columns (the code
-- before 056 doesn't). Without them nothing is dry run: check first that no
-- restaurant has a real Google profile linked that should stay dry run.

-- The closure records (and their export files: empty the account-exports bucket in
-- Supabase > Storage first) go too.
drop table if exists account_closures;
drop table if exists pilot_notes;
delete from storage.buckets where id = 'account-exports';
delete from jobs where type in ('sim_day', 'account_close');
delete from job_types where type in ('sim_day', 'account_close');
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
