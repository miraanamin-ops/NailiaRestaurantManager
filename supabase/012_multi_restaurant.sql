-- =====================================================================
-- Naila step 11: more than one restaurant
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Scheduled jobs only run for active restaurants.
alter table restaurants add column if not exists active boolean not null default true;

-- 2. Each owner WhatsApp number belongs to exactly one restaurant, because
--    that's how incoming messages find their restaurant.
create unique index if not exists restaurants_owner_whatsapp_once
  on restaurants (owner_whatsapp) where owner_whatsapp is not null;

-- 3. A second demo restaurant: a cafe in Ilford, with its own menu, voice and
--    reward. Its owner's WhatsApp number is set separately (it's your second phone).
insert into restaurants (
  id, name, cuisine, address, phone, opening_hours, menu, brand_voice,
  slug, signup_reward, brand_color, brand_dark, tagline,
  discount_cap_percent, send_window_start, send_window_end, email_test_mode, is_demo, active
) values (
  '22222222-2222-2222-2222-222222222222',
  'Cardamom Corner Café',
  'Neighbourhood café and bakery',
  '87 Cranbrook Road, Ilford IG1 4PG',
  '+44 20 8946 0456',
  '{
    "Monday":    "07:30 – 17:00",
    "Tuesday":   "07:30 – 17:00",
    "Wednesday": "07:30 – 17:00",
    "Thursday":  "07:30 – 19:00",
    "Friday":    "07:30 – 19:00",
    "Saturday":  "08:30 – 18:00",
    "Sunday":    "Closed"
  }'::jsonb,
  '[
    {"category": "Breakfast", "items": [
      {"name": "Masala Omelette",        "price": 7.50, "description": "Three eggs, onion, chilli and coriander, with toast"},
      {"name": "Avocado Toast",          "price": 8.25, "description": "Sourdough, smashed avocado, chilli flakes, poached egg"},
      {"name": "Granola Bowl",           "price": 6.50, "description": "House granola, Greek yoghurt, honey and berries"}
    ]},
    {"category": "Lunch", "items": [
      {"name": "Halloumi Wrap",          "price": 8.95, "description": "Grilled halloumi, salad and mint yoghurt"},
      {"name": "Chicken Pesto Panini",   "price": 8.50, "description": null},
      {"name": "Soup of the Day",        "price": 6.25, "description": "With warm bread"}
    ]},
    {"category": "Drinks", "items": [
      {"name": "Cardamom Latte",         "price": 3.85, "description": "Our signature"},
      {"name": "Karak Chai",             "price": 2.95, "description": null},
      {"name": "Flat White",             "price": 3.40, "description": null},
      {"name": "Fresh Orange Juice",     "price": 3.50, "description": null}
    ]},
    {"category": "Cakes & Bakes", "items": [
      {"name": "Pistachio Rose Cake",    "price": 4.50, "description": "Slice"},
      {"name": "Almond Croissant",       "price": 3.25, "description": null},
      {"name": "Date & Walnut Loaf",     "price": 3.75, "description": "Slice"}
    ]}
  ]'::jsonb,
  'Gentle, cosy and neighbourly, like a favourite local café. Calm, unhurried sentences; warm but never gushing. Use the customer''s first name. At most one emoji (☕ 🍰 🌿), often none. Mention the bakes and the cardamom latte when it fits. Never pushy. On bad reviews: thank them for the honesty, apologise simply, and invite them back to try again.',
  'cardamom-corner',
  'a free slice of Pistachio Rose Cake',
  '#0f766e',
  '#134e4a',
  'Café & bakery · Cranbrook Road, Ilford',
  15, '09:00', '21:00', true, true, true
)
on conflict (id) do nothing;

-- Its dummy customers (emails use example.com, phones the Ofcom drama range).
insert into customers (restaurant_id, name, phone, email, birthday, visit_count, last_visit, marketing_opt_in, notes, source)
select '22222222-2222-2222-2222-222222222222', v.name, v.phone, v.email, v.birthday, v.visits, v.last_visit, v.opt_in, v.notes, 'seed'
from (values
  ('Ayesha Malik',    '+44 7700 900201', 'ayesha.malik@example.com',   (current_date + 2 - interval '33 years')::date, 18, current_date - 1,  true,  'Cardamom latte every morning'),
  ('Ben Carter',      '+44 7700 900202', 'ben.carter@example.com',     (current_date + 4 - interval '41 years')::date,  6, current_date - 9,  true,  'Works from the corner table'),
  ('Chen Wei',        '+44 7700 900203', 'chen.wei@example.com',       '1989-03-14'::date,                              11, current_date - 3,  true,  null),
  ('Dina Patel',      '+44 7700 900204', 'dina.patel@example.com',     '1994-07-02'::date,                               3, current_date - 20, true,  'Brings her book club on Thursdays'),
  ('Eleanor Hughes',  '+44 7700 900205', 'eleanor.h@example.com',      '1957-11-30'::date,                              25, current_date - 2,  true,  'Pistachio rose cake fan'),
  ('Farid Khan',      '+44 7700 900206', 'farid.khan@example.com',     '1999-01-21'::date,                               2, current_date - 45, false, 'Opted out of marketing'),
  ('Grace Okoro',     '+44 7700 900207', 'grace.okoro@example.com',    '1991-05-09'::date,                               8, current_date - 6,  true,  null),
  ('Harjit Singh',    '+44 7700 900208', 'harjit.singh@example.com',   '1985-09-17'::date,                              14, current_date - 4,  true,  'Orders karak chai to go')
) as v(name, phone, email, birthday, visits, last_visit, opt_in, notes)
where not exists (select 1 from customers where restaurant_id = '22222222-2222-2222-2222-222222222222');

-- Its dummy reviews (already "seen", so the first review check doesn't reply to all of them).
insert into reviews (restaurant_id, author_name, rating, text, review_date, replied, handled_at, source)
select '22222222-2222-2222-2222-222222222222', v.author, v.rating, v.text, now() - v.ago, v.replied, now() - v.ago, 'google'
from (values
  ('Sophie L.',  5, 'The cardamom latte is the best coffee in Ilford. Lovely calm spot to work for an hour.', interval '3 days',  false),
  ('Imran A.',   4, 'Great masala omelette and friendly staff. Gets busy on Saturday mornings.',            interval '6 days',  false),
  ('Kate R.',    5, 'Pistachio rose cake is a dream. My new favourite café.',                               interval '10 days', true),
  ('Tom B.',     3, 'Nice food but the panini was a bit cold and we waited a while.',                     interval '14 days', false),
  ('Priya S.',   2, 'Wanted to come on Sunday but they were closed. Website said otherwise.',              interval '19 days', false),
  ('Joe M.',     5, 'Proper friendly local café. The almond croissants sell out early for a reason!',       interval '25 days', true)
) as v(author, rating, text, ago, replied)
where not exists (select 1 from reviews where restaurant_id = '22222222-2222-2222-2222-222222222222');

insert into schema_migrations (name) values ('012_multi_restaurant.sql') on conflict (name) do nothing;
