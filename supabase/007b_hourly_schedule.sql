-- =====================================================================
-- Naila step 7b: hourly Google review check, scheduled inside Supabase
-- (pg_cron + pg_net are free on every Supabase plan; Vercel's free plan
-- only allows once-a-day jobs).
--
-- Replace PASTE_CRON_SECRET_HERE with the CRON_SECRET value from .env.local
-- before running. (Claude puts a ready-filled copy on your clipboard.)
-- The secret is stored encrypted in Supabase Vault, not in the job itself.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store (or update) the password the job sends to our app.
do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'naila_cron_secret';
  if existing is null then
    perform vault.create_secret('PASTE_CRON_SECRET_HERE', 'naila_cron_secret');
  else
    perform vault.update_secret(existing, 'PASTE_CRON_SECRET_HERE');
  end if;
end $$;

-- Every hour at 5 past: ask the app to check for new Google reviews.
-- (Running this again just replaces the job.)
select cron.schedule(
  'naila-hourly-reviews',
  '5 * * * *',
  $job$
  select net.http_get(
    url := 'https://nailiarestaurantmanager.vercel.app/api/cron?job=hourly',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'naila_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $job$
);

-- To check it's working:  select * from cron.job_run_details order by start_time desc limit 5;
-- To stop it:             select cron.unschedule('naila-hourly-reviews');
