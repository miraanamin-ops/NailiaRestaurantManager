-- =====================================================================
-- DinerAI operations data, part 3 of 8: covers, channels, staff and rotas
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
-- Staff data is employee personal data: only what a rota needs. No NI numbers,
-- addresses, bank details or dates of birth (an age band for minimum wage).
-- Retention (docs/data-model.md): hours and pay 6 years, availability 3 months
-- after someone leaves; forget_staff_member() for an early deletion.
-- =====================================================================

-- 1. Covers on the existing daily and hourly sales (money there stays in pounds;
--    the analytics views give pence).
alter table sales_days  add column if not exists covers        int check (covers >= 0);
alter table sales_days  add column if not exists covers_source ops_source;
alter table sales_hours add column if not exists covers        int check (covers >= 0);
alter table sales_hours add column if not exists covers_source ops_source;

-- 2. Sales by channel (dine-in, takeaway, delivery), for a day or an hour.
create table if not exists sales_channel_splits (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  day             date not null,                         -- London trading day
  hour            smallint check (hour between 0 and 23),  -- London hour; empty = the whole day
  channel         text not null check (channel in ('dine_in', 'takeaway', 'delivery')),
  sales_pence     bigint not null check (sales_pence >= 0),
  includes_vat    boolean not null default true,
  orders          int check (orders >= 0),
  covers          int check (covers >= 0),
  source          ops_source not null,
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now()
);
create unique index if not exists sales_channel_splits_one_idx
  on sales_channel_splits (restaurant_id, day, coalesce(hour, -1), channel);

-- 3. Staff: the minimum a rota needs.
create unique index if not exists staff_numbers_id_restaurant_idx on staff_numbers (id, restaurant_id);

create table if not exists staff (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  display_name      text not null,                       -- "Bilal", "Sara K"
  roles             text[] not null default '{}',        -- "chef", "front", "kitchen porter"...
  skills            text[] not null default '{}',        -- "grill", "tandoor", "barista"...
  contracted_hours  numeric(5, 2) check (contracted_hours >= 0),  -- a week; empty = zero hours
  employment_start  date,
  employment_end    date,
  age_band          text check (age_band in ('under_18', '18_20', '21_plus', 'apprentice')),  -- minimum wage bands
  age_band_set_on   date,                                -- so a band can be re-checked yearly
  staff_number_id   uuid,                                -- also sends till reports from this WhatsApp number
  source            ops_source not null default 'manual',
  confirmed_at      timestamptz,
  confirmed_by      text,
  deleted_at        timestamptz,                         -- forgotten: name and details removed, hours kept
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (staff_number_id, restaurant_id) references staff_numbers (id, restaurant_id) on delete set null (staff_number_id),
  check (employment_end is null or employment_start is null or employment_end >= employment_start)
);
create index if not exists staff_restaurant_idx on staff (restaurant_id) where deleted_at is null;

-- Pay over time (history pattern: never changed, a new rate is a new row).
create table if not exists staff_pay_rates (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  staff_id        uuid not null,
  hourly_pence    int not null check (hourly_pence > 0),
  effective_from  date not null,
  recorded_at     timestamptz not null default now(),
  source          ops_source not null default 'manual',
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now(),
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id) on delete cascade
);
create index if not exists staff_pay_rates_staff_idx on staff_pay_rates (staff_id, effective_from desc, recorded_at desc);

-- A weekly pattern (Monday = 1). An end at or before the start runs past midnight.
create table if not exists staff_availability (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  staff_id        uuid not null,
  weekday         smallint not null check (weekday between 1 and 7),
  starts          time not null,
  ends            time not null,
  kind            text not null default 'available' check (kind in ('available', 'unavailable', 'preferred')),
  effective_from  date not null,
  effective_to    date,                                  -- no longer applies from this day
  source          ops_source not null default 'manual',
  created_at      timestamptz not null default now(),
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id) on delete cascade,
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists staff_availability_staff_idx on staff_availability (staff_id, weekday);

-- Exceptions to the pattern: holidays, sickness, a day they can't (or can) work.
create table if not exists staff_time_off (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  staff_id        uuid not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  kind            text not null check (kind in ('holiday', 'sick', 'unavailable', 'extra_available')),
  status          text not null default 'approved' check (status in ('requested', 'approved', 'declined', 'cancelled')),
  source          ops_source not null default 'manual',
  created_at      timestamptz not null default now(),
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id) on delete cascade,
  check (ends_at > starts_at)
);
create index if not exists staff_time_off_idx on staff_time_off (restaurant_id, starts_at);

-- 4. Cover rules: at least N people in a role for a time window, and/or one per
--    so many covers. weekday empty = every day.
create table if not exists cover_rules (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  role              text not null,
  weekday           smallint check (weekday between 1 and 7),
  starts            time not null,
  ends              time not null,
  min_staff         int not null default 0 check (min_staff >= 0),
  covers_per_staff  numeric(6, 1) check (covers_per_staff > 0),
  effective_from    date not null,
  effective_to      date,
  source            ops_source not null default 'manual',
  created_at        timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists cover_rules_restaurant_idx on cover_rules (restaurant_id, effective_from);

-- 5. Rotas: one per restaurant per week (Monday's date).
create table if not exists rota_weeks (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  week_start     date not null check (extract(isodow from week_start) = 1),
  status         text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  approved_at    timestamptz,
  approved_by    text,
  published_at   timestamptz,
  source         ops_source not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, week_start)
);

-- Planned shifts. Times in UTC; business_date is the London trading day.
-- staff_id empty = an open shift nobody has yet.
create table if not exists rota_shifts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  rota_week_id    uuid not null,
  staff_id        uuid,
  role            text not null,
  business_date   date not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  break_minutes   int not null default 0 check (break_minutes >= 0),
  notes           text,
  source          ops_source not null default 'manual',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (rota_week_id, restaurant_id) references rota_weeks (id, restaurant_id) on delete cascade,
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id),
  check (ends_at > starts_at)
);
create index if not exists rota_shifts_day_idx on rota_shifts (restaurant_id, business_date);
create index if not exists rota_shifts_week_idx on rota_shifts (rota_week_id);

-- Hours actually worked. source: photo (a rota photo), export (a rota app),
-- manual, or assumed (worked as planned, until told otherwise).
create table if not exists shift_actuals (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  staff_id        uuid,
  rota_shift_id   uuid,
  role            text,
  business_date   date not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  break_minutes   int not null default 0 check (break_minutes >= 0),
  source          ops_source not null,
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now(),
  foreign key (staff_id, restaurant_id) references staff (id, restaurant_id),
  foreign key (rota_shift_id, restaurant_id) references rota_shifts (id, restaurant_id) on delete set null (rota_shift_id),
  check (ends_at > starts_at)
);
create index if not exists shift_actuals_day_idx on shift_actuals (restaurant_id, business_date);

-- 6. A person's hourly pay on a day, as known at a moment (empty = now).
create or replace function pay_rate_on(p_staff_id uuid, p_day date, p_known_at timestamptz default null) returns int
language sql stable set search_path = public as $$
  select hourly_pence from staff_pay_rates
   where staff_id = p_staff_id and effective_from <= p_day and recorded_at <= coalesce(p_known_at, 'infinity'::timestamptz)
   order by effective_from desc, recorded_at desc, created_at desc
   limit 1
$$;

-- 7. Forgetting a person (the owner asks, or retention): their name and details
--    go, their availability and time off are deleted; hours and pay stay under
--    "Former staff N" because the owner must keep wage records.
create or replace function forget_staff_member(p_restaurant_id uuid, p_staff_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not exists (select 1 from staff where id = p_staff_id and restaurant_id = p_restaurant_id) then return false; end if;
  select count(*) + 1 into v_n from staff where restaurant_id = p_restaurant_id and deleted_at is not null and id <> p_staff_id;
  delete from staff_availability where restaurant_id = p_restaurant_id and staff_id = p_staff_id;
  delete from staff_time_off where restaurant_id = p_restaurant_id and staff_id = p_staff_id;
  update staff
     set display_name = 'Former staff ' || v_n, skills = '{}', staff_number_id = null, age_band_set_on = null,
         deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where id = p_staff_id and restaurant_id = p_restaurant_id;
  return true;
end;
$$;

-- Retention, for a scheduled clean-up: availability and time off 3 months after
-- someone leaves; shifts, actual hours, and people (with their pay) 6 years
-- after. Returns how many rows went. p_dry_run counts without deleting.
create or replace function apply_staff_retention(p_today date default null, p_dry_run boolean default true)
returns table (what text, n_rows bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, london_day(now()));
  v_short date := v_today - interval '3 months';
  v_long date := v_today - interval '6 years';
  n bigint;
begin
  select count(*) into n from staff_availability a join staff s on s.id = a.staff_id where s.employment_end < v_short;
  what := 'staff_availability'; n_rows := n; return next;
  select count(*) into n from staff_time_off t join staff s on s.id = t.staff_id where s.employment_end < v_short;
  what := 'staff_time_off'; n_rows := n; return next;
  select count(*) into n from shift_actuals where business_date < v_long;
  what := 'shift_actuals'; n_rows := n; return next;
  select count(*) into n from rota_shifts where business_date < v_long;
  what := 'rota_shifts'; n_rows := n; return next;
  select count(*) into n from staff where employment_end < v_long;
  what := 'staff'; n_rows := n; return next;
  if not p_dry_run then
    delete from staff_availability a using staff s where s.id = a.staff_id and s.employment_end < v_short;
    delete from staff_time_off t using staff s where s.id = t.staff_id and s.employment_end < v_short;
    delete from shift_actuals where business_date < v_long;
    delete from rota_shifts where business_date < v_long;
    delete from shift_actuals a using staff s where s.id = a.staff_id and s.employment_end < v_long;
    delete from rota_shifts r using staff s where s.id = r.staff_id and s.employment_end < v_long;
    delete from staff where employment_end < v_long;
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['forget_staff_member(uuid, uuid)', 'apply_staff_retention(date, boolean)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon, authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

-- 8. RLS (030).
select ops_apply_policies('sales_channel_splits', 'owned');
select ops_apply_policies('staff', 'owned');
select ops_apply_policies('staff_pay_rates', 'append');
select ops_apply_policies('staff_availability', 'owned');
select ops_apply_policies('staff_time_off', 'owned');
select ops_apply_policies('cover_rules', 'owned');
select ops_apply_policies('rota_weeks', 'owned');
select ops_apply_policies('rota_shifts', 'owned');
select ops_apply_policies('shift_actuals', 'owned');

insert into schema_migrations (name) values ('032_ops_sales_staff_rota.sql') on conflict (name) do nothing;
