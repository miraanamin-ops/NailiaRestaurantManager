-- =====================================================================
-- Naila step 12: onboarding new restaurants
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. What onboarding finds out about a restaurant.
alter table restaurants add column if not exists owner_name          text;
alter table restaurants add column if not exists website             text;
alter table restaurants add column if not exists google_place_id     text;
alter table restaurants add column if not exists google_rating       numeric(2, 1);
alter table restaurants add column if not exists google_rating_count int;
alter table restaurants add column if not exists photos              jsonb not null default '[]'::jsonb;  -- public URLs of photos from Google

-- 2. Onboarding progress: one row per restaurant being set up. The web wizard and
--    WhatsApp read and write the same row, so the owner can switch between them.
create table if not exists onboarding (
  restaurant_id         uuid primary key references restaurants(id) on delete cascade,
  steps                 jsonb not null default '{}'::jsonb,  -- e.g. {"google": {"status": "done", "at": "..."}}
  data                  jsonb not null default '{}'::jsonb,  -- work in progress: Google matches, menu draft, voice samples...
  wa_waiting            text,                                -- what the WhatsApp side is waiting for next
  link_code             text unique,                         -- the one-time code that links a WhatsApp number
  link_code_expires_at  timestamptz,
  pending_whatsapp      text,                                -- the number typed at sign-up (linked only once it sends the code)
  started_at            timestamptz not null default now(),
  completed_at          timestamptz
);
alter table onboarding enable row level security;

-- Restaurants that already exist count as set up.
insert into onboarding (restaurant_id, completed_at)
select id, now() from restaurants
on conflict (restaurant_id) do nothing;

insert into schema_migrations (name) values ('013_onboarding.sql') on conflict (name) do nothing;
