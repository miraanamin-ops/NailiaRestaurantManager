-- =====================================================================
-- DinerAI pilot sprint: what the rota needs on top of 032 (docs/pilot-sprint.md).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
-- The rota tables already exist (032_ops_sales_staff_rota.sql): staff, their
-- pay (staff_pay_rates), weekly availability (staff_availability), rotas
-- (rota_weeks, one per week) and rota_shifts. This adds:
--   1. staff.max_hours_week: the most hours a week someone wants (or may) work.
--   2. rota_rules: per role, the fewest people on any shift, and one more person
--      for every so many forecast orders an hour.
-- =====================================================================

-- 1. A weekly cap per person (empty = no cap beyond the working time rules).
alter table staff add column if not exists max_hours_week numeric(5, 2) check (max_hours_week >= 0);

-- 2. Staffing rules per role: min_on_shift always, plus one person for every
--    orders_per_extra_staff forecast orders in an hour (empty = never more).
create table if not exists rota_rules (
  id                      uuid primary key default gen_random_uuid(),
  restaurant_id           uuid not null references restaurants(id) on delete cascade,
  role                    text not null,                 -- "kitchen", "front"... as in staff.roles
  min_on_shift            int not null default 1 check (min_on_shift >= 0),
  orders_per_extra_staff  numeric(6, 1) check (orders_per_extra_staff > 0),
  source                  ops_source not null default 'manual',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (restaurant_id, role)
);

-- 3. RLS (030).
select ops_apply_policies('rota_rules', 'owned');

insert into schema_migrations (name) values ('043_pilot_rota.sql') on conflict (name) do nothing;
