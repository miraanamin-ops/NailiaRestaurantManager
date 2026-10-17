-- =====================================================================
-- DinerAI operations data, part 1 of 8: the foundation
-- (forecasting, rotas, menu engineering, finance and deals; docs/data-model.md)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- Run 030 to 036 in order. Run 037 only AFTER the new code is live.
-- =====================================================================

-- 1. Where every input row came from. One list for every operations table, so a
--    new kind of source is added in one place (alter domain ... add constraint).
--    photo          read from a photo (a till report, an invoice, a rota)
--    export         a file from another system (POS, rota app, accounting)
--    manual         typed on a settings page
--    owner_message  from the owner's WhatsApp message
--    assumed        filled in by a rule (e.g. "worked as planned")
--    feed           an outside feed (gov.uk, Open-Meteo, a fixtures list)
--    synthetic      generated test data (cleared by clear_ops_dummy_data)
--    model          written by a model (forecasts, suggestions)
--    migrated       copied from data that existed before (the menu move)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ops_source') then
    create domain ops_source as text
      check (value in ('photo', 'export', 'manual', 'owner_message', 'assumed', 'feed', 'synthetic', 'model', 'migrated'));
  end if;
end $$;

-- 2. Where each restaurant is, for school holidays, bank holidays, local events
--    and prayer times. latitude/longitude already exist (016_sales.sql).
alter table restaurants add column if not exists council_name  text;  -- "Newham"
alter table restaurants add column if not exists council_code  text;  -- ONS code, e.g. E09000025 (postcodes.io admin_district)
alter table restaurants add column if not exists nation        text;  -- school terms and bank holidays differ by nation
alter table restaurants add column if not exists prayer_method text;  -- how prayer_times were made: 'computed:<method>' or 'timetable:<mosque>'
alter table restaurants drop constraint if exists restaurants_nation_check;
alter table restaurants add constraint restaurants_nation_check
  check (nation is null or nation in ('england', 'wales', 'scotland', 'northern_ireland'));

-- 3. Small helpers used by the tables and views that follow.
-- A name as we compare it: lower case, single spaces ("Chkn  Tikka " = "chkn tikka").
create or replace function ops_name_key(p text) returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- Pounds (numeric, as the sales tables store them) to whole pence.
create or replace function ops_pence(p numeric) returns bigint
language sql immutable parallel safe as $$
  select round(p * 100)::bigint
$$;

-- The London trading day and hour of a moment.
create or replace function london_day(p timestamptz) returns date
language sql stable parallel safe as $$
  select (p at time zone 'Europe/London')::date
$$;
create or replace function london_hour(p timestamptz) returns smallint
language sql stable parallel safe as $$
  select extract(hour from (p at time zone 'Europe/London'))::smallint
$$;

-- 4. Row Level Security. The app uses the secret key, which bypasses it, so these
--    policies are a second wall for anything that ever reads with a user's login.
--    A logged-in owner (Supabase Auth) may use the rows of the restaurants whose
--    owner_email is their email. security definer: it reads restaurants itself.
create or replace function ops_owns_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurants
     where id = p_restaurant_id
       and owner_email is not null
       and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- The standard policies for an operations table (dropped and made again, so a
-- re-run applies any change). Kinds:
--   owned   owners read, add and change their own restaurant's rows
--   append  owners read and add their own rows; never change them (history)
--   output  owners read their own rows; model_writer may add rows (model outputs)
--   global  every logged-in user may read (national calendar, venues)
-- Nobody gets delete through RLS: deletes happen through the app or SQL.
create or replace function ops_apply_policies(p_table regclass, p_kind text) returns void
language plpgsql as $$
declare
  pol record;
begin
  if p_kind not in ('owned', 'append', 'output', 'global') then
    raise exception 'ops_apply_policies: unknown kind %', p_kind;
  end if;
  execute format('alter table %s enable row level security', p_table);
  for pol in select policyname from pg_policies where (schemaname || '.' || tablename)::regclass = p_table and policyname like 'ops\_%' loop
    execute format('drop policy %I on %s', pol.policyname, p_table);
  end loop;
  if p_kind = 'global' then
    execute format('create policy ops_read on %s for select to authenticated using (true)', p_table);
    return;
  end if;
  execute format('create policy ops_read on %s for select to authenticated using (ops_owns_restaurant(restaurant_id))', p_table);
  if p_kind in ('owned', 'append') then
    execute format('create policy ops_add on %s for insert to authenticated with check (ops_owns_restaurant(restaurant_id))', p_table);
  end if;
  if p_kind = 'owned' then
    execute format('create policy ops_change on %s for update to authenticated using (ops_owns_restaurant(restaurant_id)) with check (ops_owns_restaurant(restaurant_id))', p_table);
  end if;
  if p_kind = 'output' then
    execute format('create policy ops_model_add on %s for insert to model_writer with check (true)', p_table);
    execute format('grant insert on %s to model_writer', p_table);
  end if;
end;
$$;

-- 5. Roles for the coming Python service (it logs in as queue_worker, 027_job_queue.sql;
--    036 gives queue_worker both roles).
--    analytics_reader  reads the analytics.* views only, never an app table
--    model_writer      adds rows to the 6 model output tables, and finishes its
--                      own model runs through finish_model_run (035); nothing else
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'analytics_reader') then create role analytics_reader nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'model_writer') then create role model_writer nologin; end if;
end $$;
grant usage on schema public to model_writer;
grant execute on function ops_owns_restaurant(uuid) to authenticated;
revoke all on function ops_apply_policies(regclass, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function ops_apply_policies(regclass, text) from anon, authenticated;
  end if;
end $$;

-- 6. The analytics schema: read-only views for the Python service (036 fills it).
--    Supabase's API doesn't serve this schema, and nobody else is granted it.
create schema if not exists analytics;
revoke all on schema analytics from public;
grant usage on schema analytics to analytics_reader;

insert into schema_migrations (name) values ('030_ops_foundation.sql') on conflict (name) do nothing;
