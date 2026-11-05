-- =====================================================================
-- 060: direct till (EPOS) connections: Square, Epos Now, Lightspeed, Toast.
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once, and safe before the new code is live (it only adds).
--
--   1. till_connections: one per restaurant (at most one that isn't
--      disconnected). The login (token or API key) is stored encrypted by the
--      app (TILL_TOKEN_KEY); nobody can read this table except the app itself.
--   2. sales_items.till_connection_id: which connection a sale line came from,
--      so each sync can replace its own lines for a day.
--   3. job_types: the hourly till sync.
-- =====================================================================

-- 1. Till connections.
create table if not exists till_connections (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  provider           text not null check (provider in ('square', 'eposnow', 'lightspeed', 'toast')),
  mode               text not null default 'live' check (mode in ('live', 'dummy')),
  status             text not null default 'ok' check (status in ('ok', 'needs_reconnect', 'disconnected')),
  external_account   text,           -- Square merchant / Lightspeed business / Toast restaurant guid
  external_location  text,           -- Square location / Lightspeed business location
  location_name      text,
  credentials_enc    text,           -- encrypted by the app; empty for Toast and dummy mode
  synced_through     timestamptz,    -- everything closed before this has been read
  last_synced_at     timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  connected_by       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists till_connections_one_per_restaurant on till_connections (restaurant_id) where status <> 'disconnected';
create index if not exists till_connections_restaurant_idx on till_connections (restaurant_id, created_at desc);
alter table till_connections enable row level security;

-- 2. Which connection a sale line came from.
alter table sales_items add column if not exists till_connection_id uuid references till_connections(id) on delete set null;
create index if not exists sales_items_till_idx on sales_items (restaurant_id, till_connection_id, day) where till_connection_id is not null;

-- 3. The hourly sync.
insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('till_sync', 'app', 5, 3, 600, 'Hourly: new sales from the restaurant''s connected till (Square, Epos Now, Lightspeed, Toast)')
on conflict (type) do nothing;

insert into schema_migrations (name) values ('060_till_connections.sql') on conflict (name) do nothing;
