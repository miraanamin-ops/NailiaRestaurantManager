// The whole database, built the way a fresh Supabase project would be: setup.sql
// then every numbered file in supabase/, in order, running in PGlite (Postgres
// inside the test process). What only Supabase has (pg_cron, pg_net, Vault,
// storage, auth and its roles) is replaced by small stand-ins first.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const DIR = fileURLToPath(new URL("../../supabase/", import.meta.url));

// Supabase's own roles and schemas, as far as our SQL uses them.
export const SUPABASE_STANDINS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  -- Supabase gives its API roles rights on everything new in public; RLS decides the rows.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema if not exists auth;
  -- auth.jwt(): the logged-in user's token claims. Tests set them with
  -- set_config('request.jwt.claims', '{"email": "..."}', true), as PostgREST does.
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create schema if not exists cron;
  create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create table if not exists cron.job_run_details (end_time timestamptz);
  create or replace function cron.schedule(name text, schedule text, command text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (name, schedule, command)
       on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create or replace function cron.unschedule(name text) returns boolean language sql as
    $$ with d as (delete from cron.job where jobname = name returning 1) select exists (select 1 from d) $$;
  create schema if not exists net;
  create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
  create schema if not exists vault;
  create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
  create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create or replace function vault.create_secret(secret text, name text) returns uuid language sql as
    $$ insert into vault.secrets (name, secret) values (name, secret) returning id $$;
  create or replace function vault.update_secret(id uuid, secret text) returns void language sql as
    $$ update vault.secrets set secret = update_secret.secret where vault.secrets.id = update_secret.id $$;
`;

// Extensions PGlite doesn't have are stood in for above.
const strip = (sql: string) => sql.replace(/create extension if not exists (pg_cron|pg_net);/gi, "");

// supabase/ files in the order they're run: setup.sql, then 002, 003, ..., 007, 007b, 008...
export function migrationFiles(upTo?: string) {
  const numbered = readdirSync(DIR)
    .filter((f) => /^\d{3}[a-z]?_.*\.sql$/.test(f))
    .sort();
  const list = ["setup.sql", ...numbered];
  return upTo ? list.slice(0, list.indexOf(upTo) + 1) : list;
}

export const readMigration = (file: string) => strip(readFileSync(`${DIR}${file}`, "utf8"));

// A fresh database with every migration (or those up to and including `upTo`).
export async function newFullDb(opts: { upTo?: string; skip?: string[] } = {}) {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STANDINS);
  for (const file of migrationFiles(opts.upTo)) {
    if (opts.skip?.includes(file)) continue;
    try {
      await pg.exec(readMigration(file));
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return pg;
}
