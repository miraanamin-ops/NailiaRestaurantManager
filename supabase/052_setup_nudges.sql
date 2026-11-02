-- 052: the hourly job that sends setup nudges while a restaurant is being set up
-- with Dina (phase 6: one gentle Google nudge 24 hours after the steps were shown
-- or the owner said they'd invited us, if Google hasn't accepted). Safe to re-run.

insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('setup_nudges', 'app', 1, 2, 300, 'Hourly: setup nudges for restaurants still setting up with Dina (the 24-hour Google nudge)')
on conflict (type) do nothing;

insert into schema_migrations (name) values ('052_setup_nudges.sql') on conflict (name) do nothing;
