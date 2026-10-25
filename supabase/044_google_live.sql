-- =====================================================================
-- Live Google Business Profile: logins, the chosen location, and a write log.
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
--
--   1. google_connections: one Google login each. Either an owner's own
--      ("Connect Google" on their settings page, kind 'owner'), or DinerAI's
--      manager account that owners add as a Manager (kind 'manager', no
--      restaurant). The refresh token is stored encrypted by the app
--      (GOOGLE_TOKEN_KEY); nobody can read this table except the app itself.
--   2. restaurants: which login and which Google location the restaurant uses,
--      and what was imported from Google on connect.
--   3. reviews: each real Google review once, by its Google id.
--   4. google_writes: every write to Google, keyed on the job that made it,
--      so a retried job never posts twice.
-- =====================================================================

-- 1. Google logins.
create table if not exists google_connections (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid references restaurants(id) on delete cascade, -- empty for the manager account
  kind               text not null check (kind in ('owner', 'manager')),
  google_email       text,
  google_sub         text not null,                 -- Google's id for the account
  refresh_token_enc  text not null,                 -- encrypted by the app
  access_token_enc   text,
  access_expires_at  timestamptz,
  scopes             text,
  status             text not null default 'ok' check (status in ('ok', 'needs_reconnect', 'disconnected')),
  last_error         text,
  last_refreshed_at  timestamptz,
  reconnect_sent_on  date,                          -- the owner was sent a reconnect link that day
  connected_by       text,                          -- the email that logged in to our app
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'owner') = (restaurant_id is not null))
);
create index if not exists google_connections_restaurant_idx on google_connections (restaurant_id);
-- Tokens never leave the server: RLS on, and the only policy refuses everyone.
alter table google_connections enable row level security;
drop policy if exists google_connections_none on google_connections;
create policy google_connections_none on google_connections for select to authenticated using (false);

-- 2. The restaurant's Google location.
alter table restaurants add column if not exists google_connection_id uuid references google_connections(id) on delete set null;
alter table restaurants add column if not exists google_account_id    text;        -- "accounts/123"
alter table restaurants add column if not exists google_location_id   text;        -- "locations/456"
alter table restaurants add column if not exists google_location_title text;
alter table restaurants add column if not exists google_linked_at     timestamptz;
alter table restaurants add column if not exists google_import        jsonb;       -- what was read from Google on connect
alter table restaurants add column if not exists google_imported_at   timestamptz;

-- 3. Real Google reviews, once each (empty ids, e.g. dummy reviews, don't clash).
create unique index if not exists reviews_google_review_uniq on reviews (restaurant_id, google_review_id);
alter table google_posts add column if not exists google_url text;                 -- the post on Google

-- 4. Every write to Google, keyed on its job ("reply:<draft id>", "post:<draft id>").
create table if not exists google_writes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  key            text not null unique,
  action         text not null,
  status         text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts       int not null default 1,
  result         jsonb,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists google_writes_restaurant_idx on google_writes (restaurant_id, created_at desc);
alter table google_writes enable row level security;
drop policy if exists google_writes_none on google_writes;
create policy google_writes_none on google_writes for select to authenticated using (false);

insert into schema_migrations (name) values ('044_google_live.sql') on conflict (name) do nothing;
