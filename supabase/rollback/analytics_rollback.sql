-- =====================================================================
-- DinerAI: ROLLBACK of 039_analytics_jobs.sql. Only if you go back to the code
-- from before the analytics service (set ANALYTICS_JOBS to false in Vercel, or
-- revert the analytics-service merge on GitHub, and wait for it to deploy).
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
-- It keeps model_runs.role and the runs and forecasts already written.
-- =====================================================================

-- 1. Analytics jobs (waiting or finished) are dropped, then their job type.
delete from jobs where type = 'forecast_baseline';
delete from job_types where type = 'forecast_baseline';

-- 2. The service's extra functions.
drop function if exists ext_release_job(uuid, text);
drop function if exists ext_job_status(uuid);
drop function if exists ext_claim_jobs(text, text[], int, uuid);

-- 3. model_runs.role gets its old safe default back, so old code that doesn't
--    send a role can still start runs (they count as benchmarks, never shown).
alter table model_runs alter column role set default 'benchmark';

delete from schema_migrations where name = '039_analytics_jobs.sql';
