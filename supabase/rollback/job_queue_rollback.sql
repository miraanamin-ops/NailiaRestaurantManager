-- =====================================================================
-- DinerAI: ROLLBACK of the job queue (027 and 028). Only if you go back to
-- the code from before the queue (revert the job-queue merge on GitHub first,
-- and wait for Vercel to deploy it).
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
-- It keeps the jobs tables (the old code ignores them).
-- =====================================================================

-- 1. Stop starting workers (the new /api/jobs/work address won't exist any more).
select cron.unschedule(jobid) from cron.job where jobname in ('naila-queue-workers', 'naila-cron-history-cleanup');

-- 2. Agent work still waiting goes back to the old queue (agent_jobs), which the
--    old code runs from the webhook and the hourly job.
update agent_jobs a set status = 'queued', locked_until = null
 where a.status in ('queued', 'running')
   and exists (select 1 from jobs j where j.idempotency_key = 'agent:' || a.job_key and j.status in ('queued', 'running'));

-- 3. Nothing else needs moving: the old hourly job queues its own work again,
--    and the morning job picks up where it stopped (each step is marked done
--    on the restaurant). WhatsApp messages still waiting in the queue are NOT
--    answered by the old code: check /log shows nothing waiting first, or run:
--      select type, count(*) from jobs where status in ('queued', 'running') group by type;

-- 4. Empty the queue of unfinished jobs. If you go forward again later, re-run
--    027_job_queue.sql: it copies the agent work still waiting back onto the queue.
delete from jobs where status in ('queued', 'running');
