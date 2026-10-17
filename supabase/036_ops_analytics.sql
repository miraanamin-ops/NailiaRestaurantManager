-- =====================================================================
-- DinerAI operations data, part 7 of 8: analytics views and the demo clear-out
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
-- The analytics schema holds read-only views for the Python service: clean,
-- joined data in pence and UTC, without staff names, photos or contact
-- details. It logs in as queue_worker, which gets analytics_reader (read these
-- views) and model_writer (add model outputs). Neither can touch an app table.
-- =====================================================================

-- 1. London hours and clock changes. A London (day, hour) as it really happened:
--    its first UTC instant and how many minutes it lasted: 60 normally, 120 for
--    01:00 on the last Sunday of October (it happens twice), 0 for 01:00 on the
--    last Sunday of March (it doesn't happen).
create or replace function london_hour_start(p_day date, p_hour int) returns timestamptz
language sql stable parallel safe as $$
  with t as (select ((p_day + make_interval(hours => p_hour)) at time zone 'Europe/London') as ts)
  select case when london_day(ts - interval '1 hour') = p_day and london_hour(ts - interval '1 hour') = p_hour
              then ts - interval '1 hour' else ts end
    from t
$$;
create or replace function london_hour_minutes(p_day date, p_hour int) returns int
language sql stable parallel safe as $$
  with t as (select london_hour_start(p_day, p_hour) as ts)
  select case when london_day(ts) <> p_day or london_hour(ts) <> p_hour then 0
              when london_day(ts + interval '1 hour') = p_day and london_hour(ts + interval '1 hour') = p_hour then 120
              else 60 end
    from t
$$;

-- 2. The views. security_invoker is off (the default): a view reads as its owner,
--    so analytics_reader needs no rights on the tables underneath.
create or replace view analytics.restaurants as
  select id, name, slug, cuisine, is_demo, active, latitude, longitude, council_code, council_name, nation,
         prayer_method, opening_hours, special_hours, created_at
    from restaurants;

create or replace view analytics.sales_daily as
  select restaurant_id, day, ops_pence(net_sales) as net_pence, ops_pence(gross_sales) as gross_pence, ops_pence(vat) as vat_pence,
         transactions, covers, covers_source, ops_pence(card) as card_pence, ops_pence(cash) as cash_pence,
         ops_pence(discounts) as discounts_pence, ops_pence(refunds) as refunds_pence, net_estimated, source, is_dummy
    from sales_days;

-- Till hours are London hours; on the October change hour 01 covers 2 real hours.
create or replace view analytics.sales_hourly as
  select restaurant_id, day, hour, london_hour_start(day, hour) as hour_start, london_hour_minutes(day, hour) as minutes,
         ops_pence(sales) as sales_pence_incl_vat, transactions, covers, covers_source, source, is_dummy
    from sales_hours;

create or replace view analytics.sales_channels as
  select restaurant_id, day, hour, channel, sales_pence, includes_vat, orders, covers, source, confirmed_at is not null as confirmed
    from sales_channel_splits;

-- Item sales with their dish, through the till name matches.
create or replace view analytics.sales_items as
  select s.restaurant_id, s.day, s.hour, s.item, s.quantity, ops_pence(s.amount) as amount_pence_incl_vat, s.receipt,
         m.dish_id, m.is_dish, m.confidence as match_confidence, m.confirmed_at is not null as match_confirmed, s.is_dummy
    from sales_items s
    left join till_item_matches m on m.restaurant_id = s.restaurant_id and m.till_key = ops_name_key(s.item);

create or replace view analytics.dishes as
  select d.id, d.restaurant_id, s.name as section, d.name, d.allergens_confirmed, d.position,
         d.active_from, d.active_to, d.source,
         (select p.price_pence from dish_prices p where p.dish_id = d.id
           order by p.effective_from desc, p.recorded_at desc, p.created_at desc limit 1) as price_pence
    from dishes d join menu_sections s on s.id = d.section_id;

create or replace view analytics.dish_prices as
  select id, restaurant_id, dish_id, price_pence, effective_from, recorded_at, source from dish_prices;

create or replace view analytics.dish_renames as
  select restaurant_id, dish_id, old_name, new_name, renamed_at from dish_renames;

create or replace view analytics.ingredients as
  select id, restaurant_id, name, unit, category, active, confirmed_at is not null as confirmed from ingredients;

create or replace view analytics.ingredient_prices as
  select id, restaurant_id, ingredient_id, price_pence, pack_quantity, price_pence::numeric / pack_quantity as pence_per_unit,
         effective_from, recorded_at, supplier_id, source, confirmed_at is not null as confirmed
    from ingredient_prices;

create or replace view analytics.recipes as
  select v.restaurant_id, v.dish_id, v.id as recipe_version_id, v.effective_from, v.recorded_at, v.portions,
         l.ingredient_id, i.unit, l.quantity, l.waste_pct, v.confirmed_at is not null as confirmed
    from recipe_versions v
    join recipe_lines l on l.recipe_version_id = v.id
    join ingredients i on i.id = l.ingredient_id;

create or replace view analytics.till_item_matches as
  select restaurant_id, till_name, till_key, dish_id, is_dish, confidence, method, confirmed_at is not null as confirmed
    from till_item_matches;

-- Staff without names (a forecast or rota model never needs them).
create or replace view analytics.staff as
  select id, restaurant_id, roles, skills, contracted_hours, employment_start, employment_end, age_band,
         deleted_at is not null as forgotten
    from staff;

create or replace view analytics.staff_pay_rates as
  select restaurant_id, staff_id, hourly_pence, effective_from, recorded_at from staff_pay_rates;

create or replace view analytics.staff_availability as
  select restaurant_id, staff_id, weekday, starts, ends, kind, effective_from, effective_to from staff_availability;

create or replace view analytics.staff_time_off as
  select restaurant_id, staff_id, starts_at, ends_at, kind, status from staff_time_off;

create or replace view analytics.cover_rules as
  select restaurant_id, role, weekday, starts, ends, min_staff, covers_per_staff, effective_from, effective_to from cover_rules;

create or replace view analytics.rota_weeks as
  select id, restaurant_id, week_start, status, approved_at, published_at from rota_weeks;

create or replace view analytics.rota_shifts as
  select id, restaurant_id, rota_week_id, staff_id, role, business_date, starts_at, ends_at, break_minutes,
         (extract(epoch from ends_at - starts_at) / 60)::int - break_minutes as paid_minutes, source
    from rota_shifts;

create or replace view analytics.shift_actuals as
  select id, restaurant_id, staff_id, rota_shift_id, role, business_date, starts_at, ends_at, break_minutes,
         (extract(epoch from ends_at - starts_at) / 60)::int - break_minutes as paid_minutes,
         source, confirmed_at is not null as confirmed
    from shift_actuals;

create or replace view analytics.suppliers as
  select id, restaurant_id, name, category from suppliers;

create or replace view analytics.invoices as
  select id, restaurant_id, supplier_id, invoice_number, invoice_date, net_pence, vat_pence, gross_pence, status, source,
         confirmed_at is not null as confirmed
    from invoices;

create or replace view analytics.invoice_lines as
  select l.id, l.restaurant_id, l.invoice_id, i.invoice_date, l.description, l.quantity, l.unit_text, l.quantity_std,
         l.line_net_pence, l.vat_pence, l.ingredient_id, l.match_confidence, l.confirmed_at is not null as confirmed
    from invoice_lines l join invoices i on i.id = l.invoice_id;

create or replace view analytics.fixed_costs as
  select id, restaurant_id, name, category, amount_pence, frequency, effective_from, effective_to, recorded_at from fixed_costs;

create or replace view analytics.targets as
  select restaurant_id, metric, value, effective_from, recorded_at from targets;

-- Deals: each campaign with its structured offer flattened (023_growth.sql's offer_details).
create or replace view analytics.deals as
  select c.id as campaign_id, c.restaurant_id, c.name, c.segment, c.is_birthday, c.valid_from, c.valid_until, c.send_at, c.sent_at,
         c.eligible_count, c.offer_details ->> 'type' as offer_type,
         nullif(c.offer_details ->> 'discount_percent', '')::numeric as discount_percent,
         ops_pence(nullif(c.offer_details ->> 'discount_value_gbp', '')::numeric) as discount_value_pence,
         c.offer_details -> 'items' as items, c.offer_details ->> 'applies_to' as applies_to,
         c.offer_details is not null as structured
    from campaigns c;

create or replace view analytics.deal_outcomes as
  select id, restaurant_id, campaign_id, restaurant_event_id, kind, uplift_pence, uplift_pct, extra_covers,
         window_start, window_end, method, model_run_id, recorded_at, source
    from deal_outcomes;

create or replace view analytics.weather_daily as
  select restaurant_id, day, temp_max, temp_min, temp_mean, rain_mm, weather_code, source, fetched_at from weather_days;

create or replace view analytics.weather_hourly as
  select restaurant_id, hour_start, london_day(hour_start) as day, london_hour(hour_start) as hour,
         temp, rain_mm, weather_code, cloud_pct, wind_kmh, provider, source
    from weather_hours;

-- Every forecast as issued (filter issued_at <= your cut-off; never use later ones).
create or replace view analytics.weather_forecasts as
  select restaurant_id, issued_at, target_day, hour_start, temp_max, temp_min, temp, rain_mm, rain_chance, weather_code, provider, source
    from weather_forecasts;

create or replace view analytics.calendar as
  select id, restaurant_id, day as first_day, coalesce(end_day, day) as last_day, starts_at, ends_at, name, type,
         coalesce(scope, case when restaurant_id is null then 'national' else 'restaurant' end) as scope,
         region, council_code, latitude, longitude, venue_id, expected_size, date_uncertain, source
    from local_calendar;

create or replace view analytics.calendar_relevance as
  select restaurant_id, event_id, distance_m, relevant, marked_by, marked_at from calendar_relevance;

create or replace view analytics.football_fixtures as
  select f.event_id, f.competition, f.home_team, f.away_team, f.kickoff_at, f.venue_id from football_fixtures f;

create or replace view analytics.restaurant_teams as
  select restaurant_id, team from restaurant_teams;

create or replace view analytics.venues as
  select id, name, kind, latitude, longitude, capacity, teams from venues;

create or replace view analytics.prayer_times as
  select p.restaurant_id, p.day, p.fajr, p.sunrise, p.dhuhr, p.asr, p.maghrib, p.isha,
         p.fajr as sehri_ends, p.maghrib as iftar, p.method, p.method = r.prayer_method as restaurant_uses
    from prayer_times p join restaurants r on r.id = p.restaurant_id;

create or replace view analytics.restaurant_events as
  select id, restaurant_id, type, starts_at, ends_at, london_day(starts_at) as first_day,
         london_day(coalesce(ends_at, starts_at)) as last_day, treat_as_unusual, campaign_id, source
    from restaurant_events;

create or replace view analytics.model_runs as
  select id, restaurant_id, model_name, model_version, kind, status, started_at, finished_at, data_from, data_to, data_cutoff,
         backtest_metric, backtest_score, passed, metrics
    from model_runs;

create or replace view analytics.forecasts as
  select id, restaurant_id, model_run_id, target_day, hour_start, local_hour, metric, channel, low, likely, high, issued_at from forecasts;

create or replace view analytics.suggested_rotas as
  select id, restaurant_id, model_run_id, rota_week_id, total_cost_pence, labour_pct, forecast_sales_pence, issued_at from suggested_rotas;

create or replace view analytics.menu_analysis as
  select id, restaurant_id, model_run_id, dish_id, period_start, period_end, units_sold, sales_pence, food_cost_pence, margin_pence,
         popularity_index, margin_index, category, suggested_price_pence, issued_at
    from menu_analysis;

create or replace view analytics.finance_snapshots as
  select id, restaurant_id, model_run_id, week_start, sales_pence, labour_cost_pence, food_cost_pence, fixed_costs_pence,
         labour_pct, food_cost_pct, prime_cost_pct, lines, data_quality, issued_at
    from finance_snapshots;

-- 3. Who reads them: analytics_reader only (and the Python service through it).
revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to analytics_reader;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema analytics from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'queue_worker') then
    grant analytics_reader, model_writer to queue_worker;
  end if;
end $$;

-- 4. Clearing dummy data in one go (scripts/clear-dummy-data.mjs calls this):
--    every operations row marked 'synthetic', anywhere (shared tables included),
--    plus everything in the operations tables for demo restaurants, except the
--    menu (kept, like the rest of the restaurant's settings), its weather and
--    prayer times (real feeds). Real restaurants' real rows are never touched.
--    p_dry_run (the default) only counts. Returns rows per table.
create or replace function clear_ops_dummy_data(p_dry_run boolean default true)
returns table (table_name text, n_rows bigint)
language plpgsql security definer set search_path = public as $$
declare
  -- Children before parents. [table, has a source column, kept for demo restaurants]
  v_tables text[][] := array[
    ['deal_outcomes', 'y', 'n'], ['finance_snapshots', 'n', 'n'], ['menu_analysis', 'n', 'n'],
    ['suggested_rota_shifts', 'n', 'n'], ['suggested_rotas', 'n', 'n'], ['forecasts', 'n', 'n'],
    ['model_runs', 'y', 'n'], ['restaurant_events', 'y', 'n'], ['calendar_relevance', 'y', 'n'],
    ['restaurant_teams', 'y', 'n'], ['prayer_times', 'y', 'y'], ['weather_forecasts', 'y', 'y'],
    ['weather_hours', 'y', 'y'], ['targets', 'y', 'n'], ['fixed_costs', 'y', 'n'],
    ['ingredient_prices', 'y', 'n'], ['invoice_lines', 'n', 'n'], ['invoices', 'y', 'n'], ['suppliers', 'y', 'n'],
    ['shift_actuals', 'y', 'n'], ['rota_shifts', 'y', 'n'], ['rota_weeks', 'y', 'n'], ['cover_rules', 'y', 'n'],
    ['staff_time_off', 'y', 'n'], ['staff_availability', 'y', 'n'], ['staff_pay_rates', 'y', 'n'], ['staff', 'y', 'n'],
    ['sales_channel_splits', 'y', 'n'], ['till_item_matches', 'y', 'n'], ['recipe_lines', 'n', 'n'],
    ['recipe_versions', 'y', 'n'], ['ingredients', 'y', 'n'],
    ['dish_renames', 'y', 'y'], ['dish_prices', 'y', 'y'], ['dishes', 'y', 'y'], ['menu_sections', 'y', 'y']];
  v_row text[];
  v_where text;
  v_n bigint;
  v_menus uuid[];
begin
  -- Menus that will change (a synthetic dish or section), to make their copy again.
  select coalesce(array_agg(distinct restaurant_id), '{}') into v_menus from (
    select restaurant_id from dishes where source = 'synthetic'
    union select restaurant_id from menu_sections where source = 'synthetic'
    union select restaurant_id from dish_prices where source = 'synthetic') m;

  foreach v_row slice 1 in array v_tables loop
    v_where := case when v_row[2] = 'y' then 'source = ''synthetic''' else 'false' end;
    if v_row[3] = 'n' then
      v_where := v_where || ' or restaurant_id in (select id from restaurants where is_demo)';
    end if;
    execute format('select count(*) from %I where %s', v_row[1], v_where) into v_n;
    table_name := v_row[1]; n_rows := v_n; return next;
    if not p_dry_run and v_n > 0 then execute format('delete from %I where %s', v_row[1], v_where); end if;
  end loop;

  -- Shared tables: synthetic rows only.
  foreach v_row slice 1 in array array[['football_fixtures', 'source = ''synthetic'''],
                                        ['local_calendar', 'source = ''synthetic'''],
                                        ['venues', 'source = ''synthetic''']] loop
    execute format('select count(*) from %I where %s', v_row[1], v_row[2]) into v_n;
    table_name := v_row[1]; n_rows := v_n; return next;
    if not p_dry_run and v_n > 0 then execute format('delete from %I where %s', v_row[1], v_row[2]); end if;
  end loop;

  -- Synthetic covers on real sales days (demo restaurants' sales go with the script's own clear-out).
  select count(*) into v_n from sales_days where covers_source = 'synthetic';
  table_name := 'sales_days.covers'; n_rows := v_n; return next;
  select count(*) into v_n from sales_hours where covers_source = 'synthetic';
  table_name := 'sales_hours.covers'; n_rows := v_n; return next;
  if not p_dry_run then
    update sales_days set covers = null, covers_source = null where covers_source = 'synthetic';
    update sales_hours set covers = null, covers_source = null where covers_source = 'synthetic';
    perform set_config('ops.menu_write', 'on', true);
    update restaurants set menu = menu_json(id) where id = any(v_menus) and menu is distinct from menu_json(id);
    perform set_config('ops.menu_write', 'off', true);
  end if;
end;
$$;

revoke all on function clear_ops_dummy_data(boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function clear_ops_dummy_data(boolean) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function clear_ops_dummy_data(boolean) to service_role;
  end if;
end $$;

insert into schema_migrations (name) values ('036_ops_analytics.sql') on conflict (name) do nothing;
