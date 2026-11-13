-- Undoes 070_founder_dashboard.sql. The founder dashboard's history (Claude costs,
-- billing events) is lost: run only if you really mean to remove it.
drop function if exists founder_monthly_costs(timestamptz);
drop function if exists founder_monthly_activity(timestamptz);
drop function if exists founder_last_activity();
drop table if exists ai_usage;
drop table if exists billing_history;
drop table if exists founder_costs;
drop table if exists founder_settings;
drop index if exists builder_alerts_restaurant_idx;
alter table builder_alerts drop column if exists restaurant_id;
delete from schema_migrations where name = '070_founder_dashboard.sql';
