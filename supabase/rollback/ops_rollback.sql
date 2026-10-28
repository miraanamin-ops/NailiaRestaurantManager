-- =====================================================================
-- DinerAI: undo the operations data (030 to 038)
-- Paste this into Supabase > SQL Editor and click "Run" ONLY if you are going
-- back to code from before the ops-schema step (redeploy that code first).
--
-- It deletes every operations table and what's in them (dishes, staff, rotas,
-- invoices, forecasts...). The menu itself is safe: restaurants.menu was never
-- removed and holds the current menu. If you'd rather go back to the menus as
-- they were before the move, see step 5 at the end.
-- =====================================================================

begin;

-- 0e. 048 (onboarding with Dina): its owner read policies use ops_owns_restaurant.
--     Only the policies go: the setup data stays, readable by the app's server
--     only. See onboarding_dina_rollback.sql to undo 048 itself.
do $$
declare t text;
begin
  foreach t in array array['onboarding_sessions', 'onboarding_steps', 'onboarding_messages', 'setup_gaps'] loop
    if to_regclass(t) is not null then execute format('drop policy if exists ops_read on %I', t); end if;
  end loop;
end $$;

-- 0d. What 046 (finance forecast and calendar lines) built on these tables, first
--     (its policies use ops_owns_restaurant). See also
--     finance_calendar_rollback.sql, which undoes 046 alone.
drop table if exists calendar_suggestions cascade;
drop table if exists forecast_backtests cascade;
alter table restaurants drop column if exists labour_target_pct;
alter table restaurants drop column if exists forecast_error_limit_pct;
delete from schema_migrations where name = '046_finance_calendar.sql';

-- 0c. What 043 (the pilot sprint's rota rules) built on these tables, first
--     (its policy uses ops_owns_restaurant). See also pilot_rota_rollback.sql,
--     which undoes 043 alone.
drop table if exists rota_rules cascade;
delete from schema_migrations where name = '043_pilot_rota.sql';

-- 0b. What 042 (the forecast in the brief) built on these tables, first (its
--     policy uses ops_owns_restaurant, which goes below). See also
--     forecast_briefs_rollback.sql, which undoes 042 alone.
drop table if exists forecast_briefs cascade;
alter table restaurants drop constraint if exists restaurants_forecast_unvalidated_demo_only;
alter table restaurants drop column if exists forecast_unvalidated;
delete from schema_migrations where name = '042_forecast_briefs.sql';

-- 0a. What 041 (the outside data feeds) built on these tables, first (its
--     tables use the ops_source type that goes below). See also
--     outside_feeds_rollback.sql, which undoes 041 alone.
drop table if exists school_date_drafts, school_dates, councils, feed_status cascade;
drop function if exists feed_upsert_fixtures(jsonb);
drop function if exists feed_upsert_calendar(jsonb);
drop function if exists feed_insert_forecasts(jsonb);
drop function if exists restaurant_calendar(uuid, date, date);
drop function if exists ops_calendar_applies(local_calendar, restaurants) cascade;
drop trigger if exists weather_forecasts_frozen on weather_forecasts;
drop function if exists weather_forecasts_frozen();
delete from schema_migrations where name = '041_outside_feeds.sql';

-- 0. What 040 (the forecast model) built on these tables, first: its tables, its
--    helper, and the calendar trigger (it reads the notes column, which goes
--    below; its two date columns go with the other calendar columns in 4).
drop table if exists model_coefficients, forecast_drivers cascade;
drop function if exists ops_run_is_showable(uuid);
drop trigger if exists local_calendar_alt_day on local_calendar;
drop function if exists ops_calendar_alt_day();
delete from schema_migrations where name = '040_forecast_model.sql';

-- 1. The menu guard first, so restaurants.menu can be written normally again.
drop trigger if exists ops_menu_guard on restaurants;
drop trigger if exists ops_menu_after_insert on restaurants;
drop function if exists ops_menu_guard();
drop function if exists ops_menu_after_insert();

-- 2. Views, functions and roles' grants.
drop schema if exists analytics cascade;
drop function if exists clear_ops_dummy_data(boolean);
drop function if exists clear_ops_dummy_data(boolean, uuid);
drop function if exists trading_hour_date(date, int, time);
drop function if exists london_hour_start(date, int);
drop function if exists london_hour_minutes(date, int);
drop function if exists finish_model_run(uuid, text, jsonb, numeric, boolean);
drop function if exists weather_known_at(uuid, date, timestamptz);
drop function if exists weather_hour_known_at(uuid, timestamptz, timestamptz);
drop function if exists ops_distance_m(numeric, numeric, numeric, numeric);
drop function if exists target_on(uuid, text, date, timestamptz);
drop function if exists ingredient_price_on(uuid, date, timestamptz);
drop function if exists pay_rate_on(uuid, date, timestamptz);
drop function if exists forget_staff_member(uuid, uuid);
drop function if exists apply_staff_retention(date, boolean);
drop function if exists save_menu(uuid, jsonb, text, jsonb, date);
drop function if exists menu_json(uuid, boolean);
drop function if exists dish_price_on(uuid, date, timestamptz);

-- 3. The tables (children first).
drop table if exists finance_snapshots, menu_analysis, suggested_rota_shifts, suggested_rotas, forecasts cascade;
drop table if exists deal_outcomes cascade;
drop table if exists model_runs cascade;
drop table if exists restaurant_events, prayer_times, calendar_relevance, restaurant_teams, football_fixtures cascade;
drop table if exists weather_forecasts, weather_hours cascade;
drop table if exists channel_fees cascade;
drop table if exists targets, fixed_costs, ingredient_prices, invoice_lines, invoices, suppliers cascade;
drop table if exists shift_actuals, rota_shifts, rota_weeks, cover_rules, staff_time_off, staff_availability, staff_pay_rates, staff cascade;
drop table if exists sales_channel_splits cascade;
drop table if exists till_item_matches, recipe_lines, recipe_versions, ingredients cascade;
drop table if exists dish_renames, dish_prices, dishes, menu_sections cascade;
drop function if exists ops_dish_json(dishes, boolean);

-- 4. Columns and indexes added to existing tables. Calendar rows of the new
--    types (football, cultural...) are deleted so the old type list fits again.
alter table local_calendar drop constraint if exists local_calendar_dates_check;
alter table local_calendar drop constraint if exists local_calendar_scope_check;
delete from local_calendar where type not in ('religious', 'school_holiday', 'sport', 'local_event', 'bank_holiday')
                              or source not in ('builder', 'gov.uk');
alter table local_calendar drop constraint if exists local_calendar_type_check;
alter table local_calendar add constraint local_calendar_type_check
  check (type in ('religious', 'school_holiday', 'sport', 'local_event', 'bank_holiday'));
alter table local_calendar drop constraint if exists local_calendar_source_check;
alter table local_calendar add constraint local_calendar_source_check check (source in ('builder', 'gov.uk'));
drop policy if exists ops_read on local_calendar;
drop index if exists local_calendar_external_idx;
drop index if exists local_calendar_range_idx;
alter table local_calendar drop column if exists end_day, drop column if exists starts_at, drop column if exists ends_at,
  drop column if exists scope, drop column if exists region, drop column if exists council_code,
  drop column if exists latitude, drop column if exists longitude, drop column if exists venue_id,
  drop column if exists expected_size, drop column if exists external_source, drop column if exists external_id,
  drop column if exists notes, drop column if exists updated_at,
  drop column if exists alt_day, drop column if exists alt_probability;
drop table if exists venues cascade;

alter table sales_days drop column if exists covers, drop column if exists covers_source;
alter table sales_hours drop column if exists covers, drop column if exists covers_source;
drop index if exists sales_items_key_idx;
drop index if exists staff_numbers_id_restaurant_idx;
drop index if exists campaigns_id_restaurant_idx;
alter table restaurants drop constraint if exists restaurants_nation_check;
alter table restaurants drop constraint if exists restaurants_trading_day_cutoff_check;
alter table restaurants drop column if exists trading_day_cutoff;
alter table weather_days drop column if exists sunshine_hours;
alter table restaurants drop column if exists council_name, drop column if exists council_code,
  drop column if exists nation, drop column if exists prayer_method;

-- 5. The menus. restaurants.menu already holds the current menu, so nothing is
--    needed. To go back to the menus exactly as they were before 031 (losing
--    menu changes made since), remove the two dashes from the next line:
-- update restaurants r set menu = b.menu from menu_json_backup b where b.restaurant_id = r.id;
drop table if exists menu_json_backup;

-- 6. Helpers, roles and the source list.
drop function if exists ops_apply_policies(regclass, text);
drop function if exists ops_owns_restaurant(uuid);
drop function if exists london_day(timestamptz);
drop function if exists london_hour(timestamptz);
drop function if exists ops_pence(numeric);
drop function if exists ops_name_key(text);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'queue_worker') then
    if exists (select 1 from pg_roles where rolname = 'analytics_reader') then revoke analytics_reader from queue_worker; end if;
    if exists (select 1 from pg_roles where rolname = 'model_writer') then revoke model_writer from queue_worker; end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'model_writer') then
    revoke all on schema public from model_writer;
    drop role model_writer;
  end if;
  if exists (select 1 from pg_roles where rolname = 'analytics_reader') then drop role analytics_reader; end if;
end $$;
drop domain if exists ops_source;

delete from schema_migrations where name in ('030_ops_foundation.sql', '031_ops_menu.sql', '032_ops_sales_staff_rota.sql',
  '033_ops_costs_deals.sql', '034_ops_outside.sql', '035_ops_models.sql', '036_ops_analytics.sql', '037_ops_menu_guard.sql',
  '038_ops_data_gaps.sql');

commit;
