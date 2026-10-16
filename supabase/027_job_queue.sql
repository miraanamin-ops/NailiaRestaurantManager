-- =====================================================================
-- DinerAI: the job queue (one job per restaurant per task)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- Run 028_queue_schedule.sql only AFTER the new code is live.
-- =====================================================================

-- 1. Each kind of job, and its limits. Edit a row here to change a limit;
--    no redeploy needed.
--    runner        'app' (our Vercel workers) or 'external' (e.g. the Python service)
--    max_running   at most this many of this type run at once (Claude and Resend limits)
--    max_attempts  tries before the job is marked dead (and the builder alerted)
--    lock_seconds  how long a worker may hold a job before it counts as crashed
create table if not exists job_types (
  type          text primary key,
  runner        text not null default 'app' check (runner in ('app', 'external')),
  max_running   int  not null default 5 check (max_running > 0),
  max_attempts  int  not null default 5 check (max_attempts > 0),
  lock_seconds  int  not null default 300 check (lock_seconds > 0),
  description   text
);
alter table job_types enable row level security;

insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('owner_message',  'app', 20, 1, 300, 'A WhatsApp message from an owner, staff number or owner still setting up (one at a time per restaurant)'),
  ('morning',        'app', 15, 5, 300, 'One step of the morning job (release, birthday, post, report, monday, brief), in order'),
  ('agent',          'app',  6, 3, 300, 'An agent job (checker, Reputation, Visibility, Insights, Growth, GM); the record is in agent_jobs'),
  ('review_check',   'app',  5, 2, 300, 'Hourly: new Google reviews'),
  ('gm_alerts',      'app',  5, 2, 120, 'Hourly: alerts the GM held for quiet hours'),
  ('feedback',       'app',  2, 3, 300, 'Hourly: "How was your visit?" emails that are due (Resend)'),
  ('release_sends',  'app',  3, 3, 300, 'Hourly: approved sends whose time has come'),
  ('weather',        'app',  5, 3, 300, 'Hourly: the day''s weather (once a day)'),
  ('health_check',   'app',  1, 2, 120, 'Late briefs, backlog and stuck jobs (alerts the builder)'),
  ('cleanup',        'app',  1, 3, 120, 'Daily: removes old finished and dead jobs')
on conflict (type) do nothing;

-- 2. The jobs themselves.
create table if not exists jobs (
  id               uuid primary key default gen_random_uuid(),
  type             text not null references job_types(type),
  restaurant_id    uuid references restaurants(id) on delete cascade, -- empty for system jobs (health, clean-up)
  idempotency_key  text not null unique,                              -- the same key queued twice is one job
  payload          jsonb not null default '{}'::jsonb,
  priority         int  not null default 50,                          -- lower runs first: 0 owner, 10 morning before 9:30, 50 the rest
  run_at           timestamptz not null default now(),
  status           text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  attempts         int  not null default 0,
  max_attempts     int  not null default 5,
  concurrency_key  text,                                              -- jobs with the same key never run at the same time
  locked_by        text,
  locked_until     timestamptz,
  last_error       text,
  result           jsonb,
  alerted_at       timestamptz,                                       -- the builder has been told it died (once)
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index if not exists jobs_due_idx on jobs (priority, run_at) where status = 'queued';
create index if not exists jobs_running_idx on jobs (type) where status = 'running';
create index if not exists jobs_restaurant_idx on jobs (restaurant_id, status);
create index if not exists jobs_finished_idx on jobs (status, finished_at) where status in ('done', 'dead');
-- The database itself refuses two running jobs with the same concurrency key.
create unique index if not exists jobs_one_running_per_key on jobs (concurrency_key) where status = 'running' and concurrency_key is not null;
alter table jobs enable row level security;

-- 3. Waiting time before a retry: 1, 5, 15, then 60 minutes.
create or replace function job_backoff_seconds(p_attempts int) returns int
language sql immutable as $$
  select (array[60, 300, 900, 3600])[least(greatest(p_attempts, 1), 4)];
$$;

-- 4. Add a job. Returns the new job, or nothing if one with this key already exists.
create or replace function enqueue_job(
  p_type text,
  p_restaurant_id uuid,
  p_key text,
  p_payload jsonb default '{}'::jsonb,
  p_run_at timestamptz default null,
  p_priority int default 50,
  p_concurrency_key text default null,
  p_max_attempts int default null
) returns setof jobs
language plpgsql security definer set search_path = public as $$
declare
  t job_types;
begin
  select * into t from job_types where type = p_type;
  if not found then raise exception 'Unknown job type %', p_type; end if;
  return query
    insert into jobs (type, restaurant_id, idempotency_key, payload, run_at, priority, concurrency_key, max_attempts)
    values (p_type, p_restaurant_id, p_key, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()), coalesce(p_priority, 50),
            p_concurrency_key, coalesce(p_max_attempts, t.max_attempts))
    on conflict (idempotency_key) do nothing
    returning *;
end;
$$;

-- 5. Take up to p_limit due jobs for this worker: highest priority first, then
--    the longest waiting. Respects each type's max_running and never runs two
--    jobs with the same concurrency key at once. Claims take a short lock so
--    the counts are exact (a claim takes milliseconds); two workers can never
--    get the same job.
--    p_types        only these types (null = any)
--    p_runner       only types run by 'app' or 'external' (null = any)
--    p_restaurant   only this restaurant's jobs (null = any)
create or replace function claim_jobs(
  p_worker text,
  p_types text[] default null,
  p_limit int default 1,
  p_now timestamptz default null,
  p_restaurant_id uuid default null,
  p_runner text default 'app'
) returns setof jobs
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  cand jobs;
  claimed jobs;
  i int;
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  for i in 1 .. greatest(p_limit, 0) loop
    select j.* into cand
      from jobs j
      join job_types t on t.type = j.type
     where j.status = 'queued'
       and j.run_at <= v_now
       and (p_types is null or j.type = any (p_types))
       and (p_runner is null or t.runner = p_runner)
       and (p_restaurant_id is null or j.restaurant_id = p_restaurant_id)
       and (j.concurrency_key is null
            or not exists (select 1 from jobs r where r.status = 'running' and r.concurrency_key = j.concurrency_key))
       and (select count(*) from jobs r where r.status = 'running' and r.type = j.type) < t.max_running
     order by j.priority, j.run_at, j.created_at
     limit 1
     for update of j skip locked;
    exit when not found;

    update jobs
       set status = 'running',
           attempts = attempts + 1,
           locked_by = p_worker,
           locked_until = v_now + make_interval(secs => (select lock_seconds from job_types where type = cand.type)),
           started_at = v_now
     where id = cand.id
     returning * into claimed;
    return next claimed;
  end loop;
end;
$$;

-- 6. A job worked. Only the worker holding it can finish it.
create or replace function complete_job(p_id uuid, p_worker text, p_result jsonb default null, p_now timestamptz default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update jobs
     set status = 'done', result = p_result, last_error = null, locked_by = null, locked_until = null,
         finished_at = coalesce(p_now, now())
   where id = p_id and status = 'running' and locked_by = p_worker;
  return found;
end;
$$;

-- 7. A job failed: try again after the backoff, or mark it dead once it has used
--    its attempts (or p_retry is false). Returns the job as it is now.
create or replace function fail_job(p_id uuid, p_worker text, p_error text, p_retry boolean default true, p_now timestamptz default null)
returns setof jobs
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  return query
    update jobs
       set status = case when not p_retry or attempts >= max_attempts then 'dead' else 'queued' end,
           run_at = case when not p_retry or attempts >= max_attempts then run_at
                         else v_now + make_interval(secs => job_backoff_seconds(attempts)) end,
           finished_at = case when not p_retry or attempts >= max_attempts then v_now else null end,
           last_error = left(p_error, 2000),
           locked_by = null,
           locked_until = null
     where id = p_id and status = 'running' and locked_by = p_worker
    returning *;
end;
$$;

-- 8. A long job asks for more time.
create or replace function extend_job(p_id uuid, p_worker text, p_seconds int, p_now timestamptz default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update jobs set locked_until = coalesce(p_now, now()) + make_interval(secs => p_seconds)
   where id = p_id and status = 'running' and locked_by = p_worker;
  return found;
end;
$$;

-- 9. Jobs whose worker crashed or timed out (the lock passed): back in the queue,
--    or dead if that was their last attempt. Returns the jobs it changed.
create or replace function requeue_expired(p_now timestamptz default null)
returns setof jobs
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  return query
    update jobs
       set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
           run_at = case when attempts >= max_attempts then run_at else v_now end,
           finished_at = case when attempts >= max_attempts then v_now else null end,
           last_error = 'The worker stopped before finishing (crashed or timed out)',
           locked_by = null,
           locked_until = null
     where status = 'running' and locked_until < v_now
    returning *;
end;
$$;

-- 10. The builder is told about a dead job once: true only for the first caller.
create or replace function mark_job_alerted(p_id uuid, p_now timestamptz default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update jobs set alerted_at = coalesce(p_now, now()) where id = p_id and status = 'dead' and alerted_at is null;
  return found;
end;
$$;

-- 11. Retry a dead job (the builder's button on /log).
create or replace function retry_job(p_id uuid, p_now timestamptz default null)
returns setof jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
    update jobs
       set status = 'queued', attempts = 0, run_at = coalesce(p_now, now()), finished_at = null, alerted_at = null
     where id = p_id and status = 'dead'
    returning *;
end;
$$;

-- 12. Daily clean-up: finished jobs after p_done_days, dead ones after p_dead_days.
create or replace function cleanup_jobs(p_done_days int, p_dead_days int, p_now timestamptz default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  n int;
begin
  delete from jobs
   where (status = 'done' and finished_at < v_now - make_interval(days => p_done_days))
      or (status = 'dead' and finished_at < v_now - make_interval(days => p_dead_days));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 13. How many workers to start now (the every-minute schedule): one per 3 due
--     jobs, up to 10; at least one if a lock has run out, so a crashed job is
--     picked up again. 0 = nothing to do (no call is made).
create or replace function workers_wanted(p_now timestamptz default null)
returns int
language sql stable security definer set search_path = public as $$
  select greatest(
    least(10, ceil((select count(*) from jobs j join job_types t on t.type = j.type
                     where j.status = 'queued' and j.run_at <= coalesce(p_now, now()) and t.runner = 'app') / 3.0)::int),
    case when exists (select 1 from jobs where status = 'running' and locked_until < coalesce(p_now, now())) then 1 else 0 end
  );
$$;

-- 14. Queue depth per restaurant and type, for /log and the health check.
--     retrying = queued after at least one failed attempt.
create or replace function queue_stats(p_now timestamptz default null)
returns table (restaurant_id uuid, type text, queued bigint, due bigint, retrying bigint, running bigint, dead bigint, oldest_due timestamptz)
language sql stable security definer set search_path = public as $$
  select j.restaurant_id, j.type,
         count(*) filter (where j.status = 'queued'),
         count(*) filter (where j.status = 'queued' and j.run_at <= coalesce(p_now, now())),
         count(*) filter (where j.status = 'queued' and j.attempts > 0),
         count(*) filter (where j.status = 'running'),
         count(*) filter (where j.status = 'dead'),
         min(j.run_at) filter (where j.status = 'queued' and j.run_at <= coalesce(p_now, now()))
    from jobs j
   where j.status in ('queued', 'running', 'dead')
   group by j.restaurant_id, j.type;
$$;

-- 14b. The latest dead jobs (every restaurant), for the builder's /log.
create or replace function dead_jobs(p_limit int default 50)
returns setof jobs
language sql stable security definer set search_path = public as $$
  select * from jobs where status = 'dead' order by finished_at desc nulls last limit p_limit;
$$;

-- 15. External workers (e.g. the Python service). They log in as queue_worker,
--     which can only call these functions, and only for job types whose runner
--     is 'external'. It can't read or change any table directly.
create or replace function ext_enqueue_job(p_type text, p_restaurant_id uuid, p_key text, p_payload jsonb default '{}'::jsonb,
                                           p_run_at timestamptz default null, p_priority int default 50)
returns setof jobs
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from job_types where type = p_type and runner = 'external') then
    raise exception 'Job type % is not an external job type', p_type;
  end if;
  return query select * from enqueue_job(p_type, p_restaurant_id, p_key, p_payload, p_run_at, p_priority, null, null);
end;
$$;

create or replace function ext_claim_jobs(p_worker text, p_types text[], p_limit int default 1)
returns setof jobs
language plpgsql security definer set search_path = public as $$
begin
  if p_types is null or exists (select 1 from unnest(p_types) x where not exists (select 1 from job_types where type = x and runner = 'external')) then
    raise exception 'Only external job types can be claimed';
  end if;
  return query select * from claim_jobs(p_worker, p_types, p_limit, null, null, 'external');
end;
$$;

create or replace function ext_complete_job(p_id uuid, p_worker text, p_result jsonb default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jobs j join job_types t on t.type = j.type where j.id = p_id and t.runner = 'external') then return false; end if;
  return complete_job(p_id, p_worker, p_result, null);
end;
$$;

create or replace function ext_fail_job(p_id uuid, p_worker text, p_error text, p_retry boolean default true)
returns setof jobs
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jobs j join job_types t on t.type = j.type where j.id = p_id and t.runner = 'external') then return; end if;
  return query select * from fail_job(p_id, p_worker, p_error, p_retry, null);
end;
$$;

create or replace function ext_extend_job(p_id uuid, p_worker text, p_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jobs j join job_types t on t.type = j.type where j.id = p_id and t.runner = 'external') then return false; end if;
  return extend_job(p_id, p_worker, p_seconds, null);
end;
$$;

-- 16. Who may call what. Supabase lets anyone with the public key call a function
--     unless told otherwise, so every function here is closed to the public and
--     opened only to the app (service_role) or the external worker role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'queue_worker') then
    create role queue_worker nologin; -- the builder gives it a password when the Python service exists
  end if;
end;
$$;

do $$
declare
  f text;
  internal text[] := array[
    'job_backoff_seconds(int)',
    'enqueue_job(text, uuid, text, jsonb, timestamptz, int, text, int)',
    'claim_jobs(text, text[], int, timestamptz, uuid, text)',
    'complete_job(uuid, text, jsonb, timestamptz)',
    'fail_job(uuid, text, text, boolean, timestamptz)',
    'extend_job(uuid, text, int, timestamptz)',
    'requeue_expired(timestamptz)',
    'mark_job_alerted(uuid, timestamptz)',
    'retry_job(uuid, timestamptz)',
    'cleanup_jobs(int, int, timestamptz)',
    'workers_wanted(timestamptz)',
    'queue_stats(timestamptz)',
    'dead_jobs(int)'];
  external text[] := array[
    'ext_enqueue_job(text, uuid, text, jsonb, timestamptz, int)',
    'ext_claim_jobs(text, text[], int)',
    'ext_complete_job(uuid, text, jsonb)',
    'ext_fail_job(uuid, text, text, boolean)',
    'ext_extend_job(uuid, text, int)'];
  closed_to text := (select string_agg(quote_ident(rolname), ', ') from pg_roles where rolname in ('anon', 'authenticated'));
begin
  foreach f in array internal || external loop
    execute format('revoke all on function %s from public', f);
    if closed_to is not null then execute format('revoke all on function %s from %s', f, closed_to); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  foreach f in array external loop
    execute format('grant execute on function %s to queue_worker', f);
  end loop;
end;
$$;
revoke all on table jobs, job_types from queue_worker;
grant usage on schema public to queue_worker;

-- 17. Agent jobs still waiting in the old queue move to this one (agent_jobs stays
--     as the record of each agent job's output, verdict and cost).
insert into jobs (type, restaurant_id, idempotency_key, payload, priority, run_at, max_attempts)
select 'agent', a.restaurant_id, 'agent:' || a.job_key,
       jsonb_build_object('agent_job_id', a.id, 'job_key', a.job_key, 'kind', a.kind),
       50, now(), 3
  from agent_jobs a
 where a.status in ('queued', 'running')
on conflict (idempotency_key) do nothing;

insert into schema_migrations (name) values ('027_job_queue.sql') on conflict (name) do nothing;
