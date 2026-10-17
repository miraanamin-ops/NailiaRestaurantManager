-- =====================================================================
-- DinerAI: the analytics service's jobs, and benchmark model runs
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things). Run it
-- BEFORE turning on ANALYTICS_JOBS in Vercel.
--
--   1. The job types the Python service (analytics/service) runs.
--   2. A role on every model run: 'benchmark' (a yardstick for other models,
--      never shown to an owner) or 'production'. Benchmark runs and their
--      outputs are hidden from owner logins, whatever "passed" says.
--   3. Three small functions for the service: give a job back on shutdown,
--      look at one job, and claim one restaurant's jobs (for debugging).
-- =====================================================================

-- 1. External job types. Heartbeats extend the lock, so a long job keeps it;
--    a crashed worker's job is picked up again once the lock runs out.
--    max_running 4: Supabase's pooler and the worker host both stay light.
insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('forecast_baseline', 'external', 4, 3, 300,
   'Nightly: the baseline forecast (same weekday, last 4 weeks), a benchmark for the real forecast; Python service')
on conflict (type) do nothing;

-- 2. The role of each model run. No default: whoever starts a run must say
--    which it is. Runs from before this file count as benchmarks (the safe side).
alter table model_runs add column if not exists role text not null default 'benchmark';
alter table model_runs alter column role drop default;
alter table model_runs drop constraint if exists model_runs_role_check;
alter table model_runs add constraint model_runs_role_check check (role in ('benchmark', 'production'));

-- Is this a benchmark run? (Security definer so owner policies can ask without
-- reading model_runs themselves.)
create or replace function ops_run_is_benchmark(p_run_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from model_runs where id = p_run_id and role = 'benchmark')
$$;
create or replace function ops_rota_is_benchmark(p_rota_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from suggested_rotas s join model_runs m on m.id = s.model_run_id
                  where s.id = p_rota_id and m.role = 'benchmark')
$$;
revoke all on function ops_run_is_benchmark(uuid) from public;
revoke all on function ops_rota_is_benchmark(uuid) from public;
grant execute on function ops_run_is_benchmark(uuid) to authenticated;
grant execute on function ops_rota_is_benchmark(uuid) to authenticated;

-- Owner logins never see a benchmark run or anything it wrote. Restrictive
-- policies sit on top of the owner's normal read policy (030), and their names
-- don't start with ops_, so ops_apply_policies never removes them.
drop policy if exists no_benchmark_runs on model_runs;
create policy no_benchmark_runs on model_runs as restrictive for select to authenticated using (role <> 'benchmark');
drop policy if exists no_benchmark_outputs on forecasts;
create policy no_benchmark_outputs on forecasts as restrictive for select to authenticated using (not ops_run_is_benchmark(model_run_id));
drop policy if exists no_benchmark_outputs on suggested_rotas;
create policy no_benchmark_outputs on suggested_rotas as restrictive for select to authenticated using (not ops_run_is_benchmark(model_run_id));
drop policy if exists no_benchmark_outputs on suggested_rota_shifts;
create policy no_benchmark_outputs on suggested_rota_shifts as restrictive for select to authenticated using (not ops_rota_is_benchmark(suggested_rota_id));
drop policy if exists no_benchmark_outputs on menu_analysis;
create policy no_benchmark_outputs on menu_analysis as restrictive for select to authenticated using (not ops_run_is_benchmark(model_run_id));
drop policy if exists no_benchmark_outputs on finance_snapshots;
create policy no_benchmark_outputs on finance_snapshots as restrictive for select to authenticated
  using (model_run_id is null or not ops_run_is_benchmark(model_run_id));
drop policy if exists no_benchmark_outputs on deal_outcomes;
create policy no_benchmark_outputs on deal_outcomes as restrictive for select to authenticated
  using (model_run_id is null or not ops_run_is_benchmark(model_run_id));

-- The analytics view shows the role too (added at the end, so the view can be replaced).
create or replace view analytics.model_runs as
  select id, restaurant_id, model_name, model_version, kind, status, started_at, finished_at, data_from, data_to, data_cutoff,
         backtest_metric, backtest_score, passed, metrics, role
    from model_runs;
grant select on analytics.model_runs to analytics_reader;

-- 3. For the Python service (queue_worker), external job types only.

-- Give a job back without using up a try (the worker is shutting down).
create or replace function ext_release_job(p_id uuid, p_worker text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update jobs j
     set status = 'queued', attempts = greatest(j.attempts - 1, 0), run_at = now(),
         locked_by = null, locked_until = null, started_at = null
    from job_types t
   where j.id = p_id and j.status = 'running' and j.locked_by = p_worker
     and t.type = j.type and t.runner = 'external';
  return found;
end;
$$;

-- One job's state, for the service's "status" command (it can't read the jobs table).
create or replace function ext_job_status(p_id uuid)
returns table (id uuid, type text, restaurant_id uuid, status text, attempts int, max_attempts int, run_at timestamptz,
               last_error text, result jsonb, created_at timestamptz, started_at timestamptz, finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  select j.id, j.type, j.restaurant_id, j.status, j.attempts, j.max_attempts, j.run_at,
         j.last_error, j.result, j.created_at, j.started_at, j.finished_at
    from jobs j join job_types t on t.type = j.type
   where j.id = p_id and t.runner = 'external'
$$;

-- Claim only one restaurant's jobs (run-one, for debugging). The three-argument
-- ext_claim_jobs (027) is unchanged.
create or replace function ext_claim_jobs(p_worker text, p_types text[], p_limit int, p_restaurant_id uuid)
returns setof jobs
language plpgsql security definer set search_path = public as $$
begin
  if p_types is null or exists (select 1 from unnest(p_types) x where not exists (select 1 from job_types where type = x and runner = 'external')) then
    raise exception 'Only external job types can be claimed';
  end if;
  return query select * from claim_jobs(p_worker, p_types, p_limit, null, p_restaurant_id, 'external');
end;
$$;

do $$
declare
  f text;
  fns text[] := array['ext_release_job(uuid, text)', 'ext_job_status(uuid)', 'ext_claim_jobs(text, text[], int, uuid)'];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('grant execute on function %s to queue_worker', f);
  end loop;
end;
$$;

insert into schema_migrations (name) values ('039_analytics_jobs.sql') on conflict (name) do nothing;
