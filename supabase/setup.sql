-- =====================================================================
-- Naila: database setup + dummy data
-- Paste this whole file into Supabase > SQL Editor and click "Run".
--
-- WARNING: this deletes and recreates the 5 tables below, so it wipes
-- whatever is in them. That's fine while we're testing with dummy data.
-- =====================================================================

-- SAFETY GUARD: if Naila is already set up, stop here before anything is
-- deleted. Supabase runs the whole file as one go, so nothing below happens.
-- To really wipe everything and start again, delete this block first.
do $$
begin
  if to_regclass('public.restaurants') is not null then
    raise exception 'Naila is already set up, so this file stopped before deleting anything. To wipe ALL data and start again, delete the SAFETY GUARD block at the top first.';
  end if;
end $$;

drop table if exists sent_log cascade;
drop table if exists drafts cascade;
drop table if exists reviews cascade;
drop table if exists customers cascade;
drop table if exists restaurants cascade;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table restaurants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  cuisine        text,
  address        text,
  phone          text,
  opening_hours  jsonb not null default '{}'::jsonb,  -- { "Monday": "12:00–23:00", ... }
  menu           jsonb not null default '[]'::jsonb,  -- [ { category, items: [ { name, price, description } ] } ]
  brand_voice    text,                                -- how the AI should sound when writing for this restaurant
  created_at     timestamptz not null default now()
);

create table customers (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete cascade,
  name                text not null,
  phone               text,                 -- WhatsApp number
  email               text,
  birthday            date,
  visit_count         int not null default 0,
  last_visit          date,
  marketing_opt_in    boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now()
);

create table reviews (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  source         text not null default 'google',
  author_name    text not null,
  rating         int not null check (rating between 1 and 5),
  text           text,
  review_date    timestamptz not null default now(),
  replied        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Messages the AI writes for the owner to approve before anything is sent.
create table drafts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  kind           text not null check (kind in ('review_reply', 'birthday', 'promotion', 'other')),
  customer_id    uuid references customers(id) on delete set null,
  review_id      uuid references reviews(id) on delete set null,
  content        text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'sent')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- A record of everything that actually went out.
create table sent_log (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  draft_id       uuid references drafts(id) on delete set null,
  customer_id    uuid references customers(id) on delete set null,
  channel        text not null default 'whatsapp',
  recipient      text,
  content        text not null,
  status         text not null default 'sent',
  sent_at        timestamptz not null default now()
);

create index on customers (restaurant_id);
create index on reviews (restaurant_id);
create index on drafts (restaurant_id, status);
create index on sent_log (restaurant_id);

-- Lock the tables down: nobody can read them with the public key.
-- Our app reads them on the server using the secret key, which bypasses this.
alter table restaurants enable row level security;
alter table customers   enable row level security;
alter table reviews     enable row level security;
alter table drafts      enable row level security;
alter table sent_log    enable row level security;

-- ---------------------------------------------------------------------
-- Dummy data
-- (Phone numbers use the 07700 900xxx range that Ofcom reserves for
--  fiction, and emails use example.com, so none of them are real.)
-- ---------------------------------------------------------------------

insert into restaurants (id, name, cuisine, address, phone, opening_hours, menu, brand_voice) values (
  '11111111-1111-1111-1111-111111111111',
  'Ember & Spice Grill',
  'Halal charcoal grill',
  '214 Whitechapel Road, London E1 1BJ',
  '+44 20 7946 0123',
  '{
    "Monday":    "12:00 – 23:00",
    "Tuesday":   "12:00 – 23:00",
    "Wednesday": "12:00 – 23:00",
    "Thursday":  "12:00 – 23:00",
    "Friday":    "14:00 – 00:00",
    "Saturday":  "12:00 – 00:00",
    "Sunday":    "12:00 – 22:30"
  }'::jsonb,
  '[
    {"category": "Grills", "items": [
      {"name": "Mixed Grill Platter",  "price": 18.50, "description": "Lamb chops, chicken tikka, seekh kebab and wings with naan and salad"},
      {"name": "Lamb Chops (4 pcs)",   "price": 13.95, "description": "Marinated overnight and flame-grilled over charcoal"},
      {"name": "Chicken Tikka",        "price": 9.50,  "description": "Boneless chicken thigh in our house yoghurt marinade"},
      {"name": "Seekh Kebab (2 pcs)",  "price": 7.95,  "description": "Minced lamb with fresh herbs and green chilli"},
      {"name": "Peri Peri Wings (8)",  "price": 7.50,  "description": "Mild, hot or extra hot"}
    ]},
    {"category": "Burgers & Wraps", "items": [
      {"name": "Smash Burger",         "price": 8.95,  "description": "Double beef patty, cheese, house sauce, brioche bun"},
      {"name": "Chicken Tikka Wrap",   "price": 7.50,  "description": "With mint yoghurt and pickled onions"}
    ]},
    {"category": "Sides", "items": [
      {"name": "Garlic Naan",          "price": 2.95,  "description": null},
      {"name": "Masala Chips",         "price": 3.50,  "description": null},
      {"name": "Rice",                 "price": 2.95,  "description": "Pilau or plain"}
    ]},
    {"category": "Drinks & Desserts", "items": [
      {"name": "Mango Lassi",          "price": 3.95,  "description": null},
      {"name": "Karak Chai",           "price": 2.50,  "description": null},
      {"name": "Kunafa",               "price": 5.95,  "description": "Warm, with pistachio and cream"}
    ]}
  ]'::jsonb,
  'Warm, friendly and family-run. We talk to customers like regulars, even on their first visit. Short, upbeat sentences with a little East London charm. Use the customer''s first name. One or two emojis at most (🔥 😋 🙏), never a wall of them. Never pushy or salesy. Always say thank you. On bad reviews: apologise sincerely, never argue, and invite them back to make it right.'
);

-- 20 customers. The first 5 have birthdays in the next 7 days
-- (calculated from the day you run this script, so it always works).
insert into customers (restaurant_id, name, phone, email, birthday, visit_count, last_visit, marketing_opt_in, notes) values
  ('11111111-1111-1111-1111-111111111111', 'Aisha Rahman',     '+44 7700 900101', 'aisha.rahman@example.com',   (current_date + 1 - interval '29 years')::date, 14, current_date - 6,   true,  'Always orders the mixed grill'),
  ('11111111-1111-1111-1111-111111111111', 'Omar Siddiqui',    '+44 7700 900102', 'omar.s@example.com',         (current_date + 2 - interval '34 years')::date,  8, current_date - 12,  true,  'Brings family on Sundays'),
  ('11111111-1111-1111-1111-111111111111', 'Fatima Begum',     '+44 7700 900103', 'fatima.begum@example.com',   (current_date + 3 - interval '41 years')::date, 22, current_date - 3,   true,  'Regular – loves the kunafa'),
  ('11111111-1111-1111-1111-111111111111', 'Daniel Okafor',    '+44 7700 900104', 'daniel.okafor@example.com',  (current_date + 5 - interval '26 years')::date,  3, current_date - 40,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Priya Patel',      '+44 7700 900105', 'priya.patel@example.com',    (current_date + 6 - interval '31 years')::date,  5, current_date - 21,  true,  'Vegetarian friend group bookings'),
  ('11111111-1111-1111-1111-111111111111', 'Yusuf Ali',        '+44 7700 900106', 'yusuf.ali@example.com',      '1992-01-14', 11, current_date - 9,   true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Hannah Clarke',    '+44 7700 900107', 'hannah.clarke@example.com',  '1988-03-02',  2, current_date - 60,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Ibrahim Hussain',  '+44 7700 900108', 'ibrahim.h@example.com',      '1979-04-19', 17, current_date - 2,   true,  'Orders extra hot wings'),
  ('11111111-1111-1111-1111-111111111111', 'Zara Khan',        '+44 7700 900109', 'zara.khan@example.com',      '1999-05-27',  6, current_date - 15,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Tom Whitfield',    '+44 7700 900110', 'tom.whitfield@example.com',  '1985-06-08',  1, current_date - 90,  false, 'Opted out of marketing'),
  ('11111111-1111-1111-1111-111111111111', 'Maryam Chowdhury', '+44 7700 900111', 'maryam.c@example.com',       '1995-07-22',  9, current_date - 7,   true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Bilal Ahmed',      '+44 7700 900112', 'bilal.ahmed@example.com',    '1990-08-03', 13, current_date - 4,   true,  'Works nearby, lunch regular'),
  ('11111111-1111-1111-1111-111111111111', 'Sofia Rossi',      '+44 7700 900113', 'sofia.rossi@example.com',    '1993-08-30',  4, current_date - 33,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Kwame Mensah',     '+44 7700 900114', 'kwame.mensah@example.com',   '1987-09-11',  7, current_date - 18,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Leila Haddad',     '+44 7700 900115', 'leila.haddad@example.com',   '1996-11-05',  3, current_date - 45,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Hamza Malik',      '+44 7700 900116', 'hamza.malik@example.com',    '2001-11-23', 10, current_date - 5,   true,  'Big on the smash burger'),
  ('11111111-1111-1111-1111-111111111111', 'Chloe Bennett',    '+44 7700 900117', 'chloe.bennett@example.com',  '1991-12-09',  2, current_date - 75,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Abdul Karim',      '+44 7700 900118', 'abdul.karim@example.com',    '1975-12-28', 25, current_date - 1,   true,  'Our most loyal customer'),
  ('11111111-1111-1111-1111-111111111111', 'Nadia Islam',      '+44 7700 900119', 'nadia.islam@example.com',    '1998-02-16',  5, current_date - 28,  true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Ryan O''Connor',   '+44 7700 900120', 'ryan.oconnor@example.com',   '1994-10-31',  1, current_date - 120, true,  null);

-- 10 Google-style reviews, from 1 to 5 stars.
insert into reviews (restaurant_id, author_name, rating, text, review_date, replied) values
  ('11111111-1111-1111-1111-111111111111', 'Aisha R.',     5, 'Best lamb chops in East London, hands down. Staff were so welcoming and the mixed grill is huge. Will be back next week!', now() - interval '2 days',  false),
  ('11111111-1111-1111-1111-111111111111', 'Marcus T.',    5, 'Proper halal grill with real charcoal flavour. The kunafa to finish was unreal.', now() - interval '5 days',  false),
  ('11111111-1111-1111-1111-111111111111', 'Sana K.',      4, 'Really tasty food and generous portions. Took a while to get a table on Saturday night but worth the wait.', now() - interval '8 days',  false),
  ('11111111-1111-1111-1111-111111111111', 'James P.',     4, 'Great wings and the masala chips are addictive. Would love a few more veggie options.', now() - interval '11 days', false),
  ('11111111-1111-1111-1111-111111111111', 'Rukhsana B.',  3, 'Food was good but it was very loud and our naan came out cold. Chicken tikka was lovely though.', now() - interval '15 days', false),
  ('11111111-1111-1111-1111-111111111111', 'Liam G.',      3, 'Decent burger, nothing special. Prices have gone up a bit since last time.', now() - interval '19 days', false),
  ('11111111-1111-1111-1111-111111111111', 'Farah M.',     2, 'Waited 45 minutes for a takeaway order even though we were told 20. Food was fine when it arrived.', now() - interval '23 days', false),
  ('11111111-1111-1111-1111-111111111111', 'Peter W.',     1, 'Booked a table for 6 and they had no record of it. We left and went elsewhere. Very disappointing.', now() - interval '27 days', false),
  ('11111111-1111-1111-1111-111111111111', 'Imran S.',     5, 'Family-run and you can tell. The owner came over to check on us. Seekh kebabs were perfect.', now() - interval '31 days', true),
  ('11111111-1111-1111-1111-111111111111', 'Grace L.',     2, 'Lamb chops were overcooked and a bit dry. Service was friendly though, so might give it another go.', now() - interval '36 days', false);

-- ---------------------------------------------------------------------
-- Which database files have been run (see scripts/check-schema.mjs).
-- Every file in supabase/ ends by adding its own name here.
-- ---------------------------------------------------------------------
create table if not exists schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);
alter table schema_migrations enable row level security;
insert into schema_migrations (name) values ('setup.sql') on conflict (name) do nothing;
