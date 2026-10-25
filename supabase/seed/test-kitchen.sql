-- =====================================================================
-- DinerAI pilot sprint: the "Test Kitchen" demo restaurant (docs/pilot-sprint.md).
-- DEV PROJECT ONLY: it refuses any database not marked "dinerai-dev" (the live
-- one never is). Run 043_pilot_rota.sql first. Then paste this into the dev
-- project's Supabase > SQL Editor and click "Run". Not a migration (nothing is
-- recorded in schema_migrations).
-- Safe to run again: it replaces Test Kitchen's dummy sales, staff and rules
-- with fresh ones and leaves everything else alone.
--
-- What it makes (all dummy, all on a demo restaurant):
--   - Test Kitchen, a grill in East London (is_demo, not active: scheduled jobs
--     skip it until you switch it on and link a WhatsApp number). Google stays
--     in dummy mode: its reviews are rows here, nothing reaches Google.
--   - 12 months of daily and hourly sales up to yesterday (Fri and Sat busiest,
--     a little seasonality and growth), the same pattern as DUMMY_PROFILE in
--     src/lib/forecast/week-ahead-rules.ts.
--   - 8 staff across kitchen and front of house, with pay, a weekly hours cap and
--     availability (the same people as DUMMY_STAFF in src/lib/rota/types.ts),
--     and the two rota rules.
--   - 4 dummy Google reviews.
--
-- To remove it all:  delete from restaurants where id = '7e57c0de-0000-4000-8000-000000000000' and is_demo;
-- =====================================================================

do $$
begin
  -- Demo data stays on dev: only a database marked as the dev project (its
  -- description starts "dinerai-dev", set by apply_migrations.py) may run this.
  -- The live database never has the mark, so it always refuses there.
  if coalesce(shobj_description((select oid from pg_database where datname = current_database()), 'pg_database'), '') not like 'dinerai-dev%' then
    raise exception 'REFUSED: this is not the dev database (it has no "dinerai-dev" mark). Demo data never goes into the live database. Nothing changed.';
  end if;
  -- Its id must be free or already Test Kitchen's (a demo with its slug), and
  -- its staff ids must not belong to anyone else.
  if exists (select 1 from restaurants where id = '7e57c0de-0000-4000-8000-000000000000' and (not coalesce(is_demo, false) or slug is distinct from 'test-kitchen'))
     or exists (select 1 from restaurants where slug = 'test-kitchen' and id <> '7e57c0de-0000-4000-8000-000000000000')
     or exists (select 1 from staff where id::text like '7e57c0de-0000-4000-8000-00000000000_' and restaurant_id <> '7e57c0de-0000-4000-8000-000000000000') then
    raise exception 'A restaurant that is not the Test Kitchen demo already uses its id or slug: nothing changed.';
  end if;
  if to_regclass('public.rota_rules') is null then
    raise exception 'Run supabase/043_pilot_rota.sql first.';
  end if;
end $$;

-- 1. The restaurant (its menu goes into dishes on insert, 037).
insert into restaurants (
  id, name, cuisine, address, phone, opening_hours, menu, brand_voice,
  slug, signup_reward, brand_color, brand_dark, tagline,
  discount_cap_percent, send_window_start, send_window_end, is_demo, active
) values (
  '7e57c0de-0000-4000-8000-000000000000',
  'Test Kitchen',
  'Grill and burgers',
  '12 Test Street, London E1 6AN',
  '+44 20 7946 0333',
  '{
    "Monday":    "12:00 – 22:00",
    "Tuesday":   "12:00 – 22:00",
    "Wednesday": "12:00 – 22:00",
    "Thursday":  "12:00 – 22:00",
    "Friday":    "12:00 – 23:00",
    "Saturday":  "12:00 – 23:00",
    "Sunday":    "12:00 – 22:00"
  }'::jsonb,
  '[
    {"category": "Grill", "items": [
      {"name": "Mixed Grill",        "price": 18.50, "description": "Lamb chops, chicken tikka and seekh kebab"},
      {"name": "Chicken Tikka",      "price": 11.50, "description": null},
      {"name": "Smash Burger",       "price": 10.95, "description": "Double patty, cheese, house sauce"}
    ]},
    {"category": "Sides", "items": [
      {"name": "Masala Chips",       "price": 4.25, "description": null},
      {"name": "Garlic Naan",        "price": 3.25, "description": null}
    ]},
    {"category": "Drinks", "items": [
      {"name": "Mango Lassi",        "price": 3.95, "description": null},
      {"name": "Soft Drink",         "price": 2.25, "description": null}
    ]}
  ]'::jsonb,
  'Friendly and straightforward. Short sentences, no jargon, at most one emoji. Thank people by name.',
  'test-kitchen',
  'a free portion of masala chips',
  '#b45309',
  '#451a03',
  'Grill and burgers · Test Street, London',
  20, '09:00', '21:00', true, false
)
on conflict (id) do nothing;

-- 2. 12 months of dummy sales, up to yesterday. A wobble from hashtext() keeps
--    the numbers the same on every run.
delete from sales_hours where restaurant_id = '7e57c0de-0000-4000-8000-000000000000' and is_dummy;
delete from sales_days  where restaurant_id = '7e57c0de-0000-4000-8000-000000000000' and is_dummy;

drop table if exists tk_days;
create temporary table tk_days as
select d::date as day,
       extract(isodow from d)::int as wd,
       greatest(1, round(
         (array[62, 58, 66, 78, 118, 132, 96])[extract(isodow from d)::int]
         * (array[0.88, 0.92, 0.97, 1.0, 1.03, 1.05, 1.06, 1.04, 1.0, 1.0, 0.98, 1.12])[extract(month from d)::int]
         * (0.97 + 0.06 * (d::date - (current_date - 365)) / 365.0)
         * (0.92 + (abs(hashtext('tk-orders-' || d::date)) % 1000) / 1000.0 * 0.16)
       ))::int as orders,
       (19.0 + (abs(hashtext('tk-spend-' || d::date)) % 1000) / 1000.0 * 2.0) as net_per_order
  from generate_series(current_date - 365, current_date - 1, interval '1 day') d
 where not exists (select 1 from sales_days s where s.restaurant_id = '7e57c0de-0000-4000-8000-000000000000' and s.day = d::date);

insert into sales_days (restaurant_id, day, net_sales, gross_sales, vat, transactions, card, cash, discounts, refunds,
                        net_estimated, source, is_dummy, covers, covers_source)
select '7e57c0de-0000-4000-8000-000000000000', day,
       round(orders * net_per_order, 2),
       round(orders * net_per_order * 1.2, 2),
       round(orders * net_per_order * 0.2, 2),
       orders,
       round(orders * net_per_order * 1.2 * 0.85, 2),
       round(orders * net_per_order * 1.2 * 0.15, 2),
       round(orders * net_per_order * 1.2 * 0.015, 2),
       0, false, 'seed', true,
       round(orders * 1.6)::int, 'synthetic'
  from tk_days;

-- Hours: lunch and evening peaks; Friday and Saturday open an hour later.
insert into sales_hours (restaurant_id, day, hour, sales, transactions, source, is_dummy)
select '7e57c0de-0000-4000-8000-000000000000', t.day, h.hour,
       round(t.orders * t.net_per_order * 1.2 * h.w / sum(h.w) over (partition by t.day), 2),
       round(t.orders * h.w / sum(h.w) over (partition by t.day))::int,
       'seed', true
  from tk_days t
  join (values (12, 6), (13, 8), (14, 4), (15, 2), (16, 2), (17, 5), (18, 10), (19, 13), (20, 12), (21, 8), (22, 4)) as h(hour, w)
    on h.hour < 22 or t.wd in (5, 6);

drop table tk_days;

-- 3. Staff: 4 in the kitchen, 3 front of house, 1 who does both.
insert into staff (id, restaurant_id, display_name, roles, contracted_hours, max_hours_week, employment_start, age_band, age_band_set_on, source)
select v.id::uuid, '7e57c0de-0000-4000-8000-000000000000', v.name, v.roles, v.contracted, v.max_hours, current_date - 400, '21_plus', current_date - 400, 'synthetic'
  from (values
    ('7e57c0de-0000-4000-8000-000000000001', 'Aisha (head chef)', array['kitchen'],          40, 45),
    ('7e57c0de-0000-4000-8000-000000000002', 'Tomasz',            array['kitchen'],          35, 40),
    ('7e57c0de-0000-4000-8000-000000000003', 'Ravi',              array['kitchen'],          null, 30),
    ('7e57c0de-0000-4000-8000-000000000004', 'Leah',              array['kitchen'],          null, 20),
    ('7e57c0de-0000-4000-8000-000000000005', 'Sam (manager)',     array['front'],            40, 45),
    ('7e57c0de-0000-4000-8000-000000000006', 'Priya',             array['front'],            30, 35),
    ('7e57c0de-0000-4000-8000-000000000007', 'Jordan',            array['front'],            null, 16),
    ('7e57c0de-0000-4000-8000-000000000008', 'Mo',                array['front', 'kitchen'], null, 24)
  ) as v(id, name, roles, contracted, max_hours)
on conflict (id) do update set
  display_name = excluded.display_name, roles = excluded.roles, contracted_hours = excluded.contracted_hours,
  max_hours_week = excluded.max_hours_week, employment_end = null, deleted_at = null, updated_at = now();

delete from staff_pay_rates   where restaurant_id = '7e57c0de-0000-4000-8000-000000000000' and source = 'synthetic';
delete from staff_availability where restaurant_id = '7e57c0de-0000-4000-8000-000000000000' and source = 'synthetic';

insert into staff_pay_rates (restaurant_id, staff_id, hourly_pence, effective_from, source)
select '7e57c0de-0000-4000-8000-000000000000', ('7e57c0de-0000-4000-8000-00000000000' || v.n)::uuid, v.pence, current_date - 365, 'synthetic'
  from (values (1, 1650), (2, 1350), (3, 1250), (4, 1221), (5, 1500), (6, 1250), (7, 1221), (8, 1221)) as v(n, pence);

-- Availability by weekday (Monday = 1).
insert into staff_availability (restaurant_id, staff_id, weekday, starts, ends, kind, effective_from, source)
select '7e57c0de-0000-4000-8000-000000000000', ('7e57c0de-0000-4000-8000-00000000000' || v.n)::uuid, wd, v.starts::time, v.ends::time, 'available', current_date - 365, 'synthetic'
  from (values
    (1, array[2, 3, 4, 5, 6],       '11:00', '23:00'),
    (2, array[1, 2, 3, 4, 5, 6, 7], '11:00', '23:00'),
    (3, array[1, 2, 3, 4, 5],       '16:00', '23:00'),
    (4, array[5, 6, 7],             '11:00', '23:00'),
    (5, array[1, 2, 3, 4, 5, 6],    '11:00', '23:00'),
    (6, array[1, 2, 3, 4, 5, 6, 7], '11:30', '22:30'),
    (7, array[4, 5, 6],             '17:00', '23:00'),
    (8, array[1, 3, 5, 6, 7],       '12:00', '22:00')
  ) as v(n, days, starts, ends)
  cross join lateral unnest(v.days) as wd;

-- 4. Rota rules: always 2 in the kitchen and 1 front of house, plus one more
--    for every 12 (kitchen) or 15 (front) forecast orders in an hour.
insert into rota_rules (restaurant_id, role, min_on_shift, orders_per_extra_staff, source) values
  ('7e57c0de-0000-4000-8000-000000000000', 'kitchen', 2, 12, 'synthetic'),
  ('7e57c0de-0000-4000-8000-000000000000', 'front',   1, 15, 'synthetic')
on conflict (restaurant_id, role) do update set
  min_on_shift = excluded.min_on_shift, orders_per_extra_staff = excluded.orders_per_extra_staff, updated_at = now();

-- 5. Dummy Google reviews (already "seen", so the first review check doesn't reply to all of them).
insert into reviews (restaurant_id, author_name, rating, text, review_date, replied, handled_at, source)
select '7e57c0de-0000-4000-8000-000000000000', v.author, v.rating, v.text, now() - v.ago, v.replied, now() - v.ago, 'google'
  from (values
    ('Dan K.',   5, 'Best mixed grill in the area. Quick and friendly.',          interval '2 days',  false),
    ('Hana S.',  4, 'Great burger, chips could be crispier. Busy on Saturday.',   interval '8 days',  true),
    ('Lewis P.', 3, 'Food was good but we waited 30 minutes on a Friday night.',  interval '15 days', false),
    ('Mina R.',  5, 'Lovely staff and the lassi is spot on.',                     interval '22 days', true)
  ) as v(author, rating, text, ago, replied)
 where not exists (select 1 from reviews where restaurant_id = '7e57c0de-0000-4000-8000-000000000000');
