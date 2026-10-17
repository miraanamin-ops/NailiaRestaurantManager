-- =====================================================================
-- DinerAI operations data: gaps found while building the synthetic data
-- (analytics/generator; docs/data-model.md).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site at any time (it only adds things and redefines views and one
-- clean-up function).
--
--   1. Sunshine in the weather (hourly minutes, daily hours, and in forecasts).
--   2. The trading day: a per-restaurant cut-off (default 05:00). A till hour
--      before it belongs to the trading day that started the day before, so
--      00:30 sales of a late takeaway stay on Saturday's report but happen on
--      Sunday's date. analytics.sales_hourly uses it.
--   3. Clearing one restaurant's dummy data (clear_ops_dummy_data gets an
--      optional restaurant).
--   4. channel_fees: what each sales channel costs (delivery app commission
--      as a % plus a fixed fee per order), with history.
-- =====================================================================

-- 1. Sunshine. Open-Meteo gives seconds of sunshine per hour (and per day).
alter table weather_hours     add column if not exists sunshine_min   smallint check (sunshine_min between 0 and 60);
alter table weather_days      add column if not exists sunshine_hours numeric(4, 1) check (sunshine_hours between 0 and 24);
-- Forecasts keep the same split as temperature: hourly rows use sunshine_min, daily rows sunshine_hours.
alter table weather_forecasts add column if not exists sunshine_min   smallint check (sunshine_min between 0 and 60);
alter table weather_forecasts add column if not exists sunshine_hours numeric(4, 1) check (sunshine_hours between 0 and 24);

-- 2. The trading day. sales_days, sales_hours, z_reports and shifts are kept by
--    trading day. A till hour (0 to 23) earlier than the cut-off is on the next
--    calendar date. Whole hours only, because till hours are whole hours.
alter table restaurants add column if not exists trading_day_cutoff time not null default '05:00';
alter table restaurants drop constraint if exists restaurants_trading_day_cutoff_check;
alter table restaurants add constraint restaurants_trading_day_cutoff_check
  check (extract(minute from trading_day_cutoff) = 0 and extract(second from trading_day_cutoff) = 0);

-- The calendar date of till hour p_hour on trading day p_day.
create or replace function trading_hour_date(p_day date, p_hour int, p_cutoff time default '05:00') returns date
language sql immutable parallel safe as $$
  select case when p_hour < extract(hour from p_cutoff)::int then p_day + 1 else p_day end
$$;

-- 4. Channel fees: a span pattern like fixed_costs (effective_from, effective_to =
--    the first day it no longer applies). Several rows may be active for one
--    channel (two delivery apps); notes says which.
create table if not exists channel_fees (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete cascade,
  channel             text not null check (channel in ('dine_in', 'takeaway', 'delivery')),
  fee_pct             numeric(5, 2) not null default 0 check (fee_pct >= 0 and fee_pct <= 100),  -- of the order value including VAT
  fee_per_order_pence int not null default 0 check (fee_per_order_pence >= 0),
  effective_from      date not null,
  effective_to        date,                                                                      -- no longer applies from this day
  recorded_at         timestamptz not null default now(),
  notes               text,                                                                      -- "Deliveroo, standard plan"
  source              ops_source not null default 'manual',
  confirmed_at        timestamptz,
  confirmed_by        text,
  created_at          timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists channel_fees_restaurant_idx on channel_fees (restaurant_id, channel, effective_from);
select ops_apply_policies('channel_fees', 'owned');

-- 5. The views (new columns go at the end, so nothing that reads them changes).
create or replace view analytics.restaurants as
  select id, name, slug, cuisine, is_demo, active, latitude, longitude, council_code, council_name, nation,
         prayer_method, opening_hours, special_hours, created_at, trading_day_cutoff
    from restaurants;

-- day is the trading day; hour_start and minutes are when the hour really happened.
create or replace view analytics.sales_hourly as
  select h.restaurant_id, h.day, h.hour,
         london_hour_start(trading_hour_date(h.day, h.hour, r.trading_day_cutoff), h.hour) as hour_start,
         london_hour_minutes(trading_hour_date(h.day, h.hour, r.trading_day_cutoff), h.hour) as minutes,
         ops_pence(h.sales) as sales_pence_incl_vat, h.transactions, h.covers, h.covers_source, h.source, h.is_dummy,
         trading_hour_date(h.day, h.hour, r.trading_day_cutoff) as calendar_day
    from sales_hours h join restaurants r on r.id = h.restaurant_id;

create or replace view analytics.weather_daily as
  select restaurant_id, day, temp_max, temp_min, temp_mean, rain_mm, weather_code, source, fetched_at, sunshine_hours from weather_days;

create or replace view analytics.weather_hourly as
  select restaurant_id, hour_start, london_day(hour_start) as day, london_hour(hour_start) as hour,
         temp, rain_mm, weather_code, cloud_pct, wind_kmh, provider, source, sunshine_min
    from weather_hours;

create or replace view analytics.weather_forecasts as
  select restaurant_id, issued_at, target_day, hour_start, temp_max, temp_min, temp, rain_mm, rain_chance, weather_code, provider, source,
         sunshine_min, sunshine_hours
    from weather_forecasts;

create or replace view analytics.channel_fees as
  select id, restaurant_id, channel, fee_pct, fee_per_order_pence, effective_from, effective_to, recorded_at, source,
         confirmed_at is not null as confirmed
    from channel_fees;

revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to analytics_reader;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema analytics from anon, authenticated;
  end if;
end $$;

-- 3. The demo clear-out, now for every restaurant (p_restaurant_id empty, as
--    before) or just one. The rule is the same either way: rows marked
--    'synthetic', plus everything in the operations tables of a demo restaurant
--    except its menu, weather and prayer times. With a restaurant, shared rows
--    (venues) go only when nothing points at them any more.
drop function if exists clear_ops_dummy_data(boolean);
create or replace function clear_ops_dummy_data(p_dry_run boolean default true, p_restaurant_id uuid default null)
returns table (table_name text, n_rows bigint)
language plpgsql security definer set search_path = public as $$
declare
  -- Children before parents. [table, has a source column, kept for demo restaurants]
  v_tables text[][] := array[
    ['deal_outcomes', 'y', 'n'], ['finance_snapshots', 'n', 'n'], ['menu_analysis', 'n', 'n'],
    ['suggested_rota_shifts', 'n', 'n'], ['suggested_rotas', 'n', 'n'], ['forecasts', 'n', 'n'],
    ['model_runs', 'y', 'n'], ['restaurant_events', 'y', 'n'], ['calendar_relevance', 'y', 'n'],
    ['restaurant_teams', 'y', 'n'], ['prayer_times', 'y', 'y'], ['weather_forecasts', 'y', 'y'],
    ['weather_hours', 'y', 'y'], ['channel_fees', 'y', 'n'], ['targets', 'y', 'n'], ['fixed_costs', 'y', 'n'],
    ['ingredient_prices', 'y', 'n'], ['invoice_lines', 'n', 'n'], ['invoices', 'y', 'n'], ['suppliers', 'y', 'n'],
    ['shift_actuals', 'y', 'n'], ['rota_shifts', 'y', 'n'], ['rota_weeks', 'y', 'n'], ['cover_rules', 'y', 'n'],
    ['staff_time_off', 'y', 'n'], ['staff_availability', 'y', 'n'], ['staff_pay_rates', 'y', 'n'], ['staff', 'y', 'n'],
    ['sales_channel_splits', 'y', 'n'], ['till_item_matches', 'y', 'n'], ['recipe_lines', 'n', 'n'],
    ['recipe_versions', 'y', 'n'], ['ingredients', 'y', 'n'],
    ['dish_renames', 'y', 'y'], ['dish_prices', 'y', 'y'], ['dishes', 'y', 'y'], ['menu_sections', 'y', 'y']];
  v_row text[];
  v_where text;
  v_only text := case when p_restaurant_id is null then 'true' else format('restaurant_id = %L', p_restaurant_id) end;
  v_n bigint;
  v_menus uuid[];
begin
  -- Menus that will change (a synthetic dish or section), to make their copy again.
  select coalesce(array_agg(distinct restaurant_id), '{}') into v_menus from (
    select restaurant_id from dishes where source = 'synthetic'
    union select restaurant_id from menu_sections where source = 'synthetic'
    union select restaurant_id from dish_prices where source = 'synthetic') m
  where p_restaurant_id is null or restaurant_id = p_restaurant_id;

  foreach v_row slice 1 in array v_tables loop
    v_where := case when v_row[2] = 'y' then 'source = ''synthetic''' else 'false' end;
    if v_row[3] = 'n' then
      v_where := v_where || ' or restaurant_id in (select id from restaurants where is_demo)';
    end if;
    v_where := format('(%s) and %s', v_where, v_only);
    execute format('select count(*) from %I where %s', v_row[1], v_where) into v_n;
    table_name := v_row[1]; n_rows := v_n; return next;
    if not p_dry_run and v_n > 0 then execute format('delete from %I where %s', v_row[1], v_where); end if;
  end loop;

  -- Calendar events (a football event takes its fixture with it).
  execute format('select count(*) from football_fixtures f where f.source = ''synthetic'' and (%s or f.event_id in (select id from local_calendar where %s))',
                 case when p_restaurant_id is null then 'true' else 'false' end, v_only) into v_n;
  table_name := 'football_fixtures'; n_rows := v_n; return next;
  if not p_dry_run and v_n > 0 then
    execute format('delete from football_fixtures f where f.source = ''synthetic'' and (%s or f.event_id in (select id from local_calendar where %s))',
                   case when p_restaurant_id is null then 'true' else 'false' end, v_only);
  end if;
  execute format('select count(*) from local_calendar where source = ''synthetic'' and %s', v_only) into v_n;
  table_name := 'local_calendar'; n_rows := v_n; return next;
  if not p_dry_run and v_n > 0 then execute format('delete from local_calendar where source = ''synthetic'' and %s', v_only); end if;

  -- Shared venues: all synthetic ones, or (for one restaurant) those nothing else uses.
  select count(*) into v_n from venues v where v.source = 'synthetic'
    and (p_restaurant_id is null or not exists (
      select 1 from local_calendar c where c.venue_id = v.id and not (c.source = 'synthetic' and c.restaurant_id = p_restaurant_id))
      and not exists (select 1 from football_fixtures f join local_calendar c on c.id = f.event_id
                       where f.venue_id = v.id and not (c.source = 'synthetic' and c.restaurant_id = p_restaurant_id)));
  table_name := 'venues'; n_rows := v_n; return next;
  if not p_dry_run and v_n > 0 then
    delete from venues v where v.source = 'synthetic'
      and (p_restaurant_id is null or not exists (
        select 1 from local_calendar c where c.venue_id = v.id and not (c.source = 'synthetic' and c.restaurant_id = p_restaurant_id))
        and not exists (select 1 from football_fixtures f join local_calendar c on c.id = f.event_id
                         where f.venue_id = v.id and not (c.source = 'synthetic' and c.restaurant_id = p_restaurant_id)));
  end if;

  -- Synthetic covers on real sales days (demo restaurants' sales go with the script's own clear-out).
  select count(*) into v_n from sales_days where covers_source = 'synthetic' and (p_restaurant_id is null or restaurant_id = p_restaurant_id);
  table_name := 'sales_days.covers'; n_rows := v_n; return next;
  select count(*) into v_n from sales_hours where covers_source = 'synthetic' and (p_restaurant_id is null or restaurant_id = p_restaurant_id);
  table_name := 'sales_hours.covers'; n_rows := v_n; return next;
  if not p_dry_run then
    update sales_days set covers = null, covers_source = null
      where covers_source = 'synthetic' and (p_restaurant_id is null or restaurant_id = p_restaurant_id);
    update sales_hours set covers = null, covers_source = null
      where covers_source = 'synthetic' and (p_restaurant_id is null or restaurant_id = p_restaurant_id);
    perform set_config('ops.menu_write', 'on', true);
    update restaurants set menu = menu_json(id) where id = any(v_menus) and menu is distinct from menu_json(id);
    perform set_config('ops.menu_write', 'off', true);
  end if;
end;
$$;

revoke all on function clear_ops_dummy_data(boolean, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function clear_ops_dummy_data(boolean, uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function clear_ops_dummy_data(boolean, uuid) to service_role;
  end if;
end $$;

insert into schema_migrations (name) values ('038_ops_data_gaps.sql') on conflict (name) do nothing;
