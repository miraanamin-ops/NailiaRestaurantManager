-- =====================================================================
-- DinerAI: start queue workers every minute
-- Paste this into Supabase > SQL Editor and click "Run".
-- Run it AFTER 027_job_queue.sql and AFTER the new code is live (it calls
-- /api/jobs/work, which only exists in the new code).
-- Safe to run more than once (scheduling the same name replaces the job).
-- Uses the same secret as the hourly job (naila_cron_secret in Supabase Vault).
-- =====================================================================

-- Every minute: start as many workers as the queue needs right now (one per 3
-- due jobs, up to 10; see workers_wanted in 027). When nothing is due no call
-- is made at all, so a quiet queue costs nothing.
-- The hourly job (naila-hourly-reviews, 5 past every hour) stays as it is: the
-- same address now only queues the work and starts workers.
select cron.schedule(
  'naila-queue-workers',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://app.dinerai.co.uk/api/jobs/work',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'naila_cron_secret')
    ),
    timeout_milliseconds := 10000
  )
  from generate_series(1, workers_wanted());
  $job$
);

-- To check it: select jobname, schedule, command from cron.job;
-- and a few minutes later:
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'naila-queue-workers')
--   order by start_time desc limit 5;
-- To stop it (rollback): select cron.unschedule('naila-queue-workers');

-- pg_cron keeps a row for every run; at one a minute, clear rows older than 3 days each night.
select cron.schedule(
  'naila-cron-history-cleanup',
  '30 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days' $job$
);

insert into schema_migrations (name) values ('028_queue_schedule.sql') on conflict (name) do nothing;
