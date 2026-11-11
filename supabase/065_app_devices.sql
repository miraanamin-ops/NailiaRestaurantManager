-- 065: phones with the DinerAI app, for push notifications (step 50, phase 2).
-- A phone belongs to a login (the owner's email), not a restaurant: an owner's
-- phones get their restaurant's notifications (restaurants.owner_email); the
-- builder's own phones never get other restaurants' alerts. Safe to re-run.

create table if not exists app_devices (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,                 -- lower case, as logged in
  push_token text not null unique,           -- ExponentPushToken[...]
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), -- the app was last opened
  disabled_at timestamptz,                   -- Expo said the app was uninstalled (DeviceNotRegistered), or logged out
  last_nudge_at timestamptz                  -- the last "haven't seen you in a while" notification
);
create index if not exists app_devices_owner on app_devices (owner_email) where disabled_at is null;
alter table app_devices enable row level security;

insert into schema_migrations (name) values ('065_app_devices.sql') on conflict (name) do nothing;
