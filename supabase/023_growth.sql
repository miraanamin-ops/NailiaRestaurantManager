-- =====================================================================
-- DinerAI agent organisation, phase 3c: the Growth agent
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. The kinds of offer the owner is happy to run (Growth only proposes these):
--    percent_off, money_off, free_item, kids_eat_free, two_for_one. Empty = not set yet.
alter table restaurants add column if not exists approved_offer_types text[] not null default '{}';

-- 2. The birthday offer (e.g. "Free dessert in your birthday week"). Empty = Growth asks the owner.
alter table restaurants add column if not exists birthday_offer text;

-- 3. A campaign's offer as structured fields, so the gate can check the discount
--    cap from them (not only from the wording):
--    { "type": "free_item", "description": "...", "items": ["Mango Lassi"], "applies_to": "Mixed Grill Platter",
--      "discount_percent": null, "discount_value_gbp": 3.5, "valid_from": "...", "valid_to": "...", "conditions": "..." }
--    Campaigns written before Growth have none (the wording check still applies).
alter table campaigns add column if not exists offer_details jsonb;

-- 4. The local calendar: dates worth planning a campaign around. restaurant_id empty =
--    every restaurant (bank holidays, Eid, Christmas); set = one restaurant's local event.
create table if not exists local_calendar (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid references restaurants(id) on delete cascade,
  day             date not null,
  name            text not null,
  type            text not null check (type in ('religious', 'school_holiday', 'sport', 'local_event', 'bank_holiday')),
  date_uncertain  boolean not null default false,   -- e.g. Eid, which depends on the moon
  source          text not null default 'builder' check (source in ('builder', 'gov.uk')),
  created_at      timestamptz not null default now()
);
create unique index if not exists local_calendar_one_per_day
  on local_calendar (coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), day, name);
create index if not exists local_calendar_day_idx on local_calendar (day);
alter table local_calendar enable row level security;

insert into schema_migrations (name) values ('023_growth.sql') on conflict (name) do nothing;
