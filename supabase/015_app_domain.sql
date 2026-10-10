-- =====================================================================
-- Naila step 14: the app moves to app.dinerai.co.uk
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once. Uses the same secret as before (in Supabase Vault).
-- =====================================================================

-- The hourly job now calls the app on its new address.
-- (Running cron.schedule with the same name replaces the old job.)
select cron.schedule(
  'naila-hourly-reviews',
  '5 * * * *',
  $job$
  select net.http_get(
    url := 'https://app.dinerai.co.uk/api/cron?job=hourly',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'naila_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $job$
);

-- To check it: select jobname, command from cron.job;  and after 5 past the hour:
--              select status, return_message, start_time from cron.job_run_details order by start_time desc limit 3;

insert into schema_migrations (name) values ('015_app_domain.sql') on conflict (name) do nothing;
