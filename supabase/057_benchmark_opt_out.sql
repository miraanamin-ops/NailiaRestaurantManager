-- 057: "How you compare nearby" in the monthly report (docs/monthly-report.md).
-- Restaurants are in nearby comparisons by default (covered by the terms); an owner
-- can switch it off in settings, which also hides the comparison from their own
-- report (a fair exchange). Only medians of 5 or more restaurants are ever shown.
-- Safe to re-run, and safe before the new code is live (it only adds a column).

alter table restaurants add column if not exists benchmark_opt_out boolean not null default false;

insert into schema_migrations (name) values ('057_benchmark_opt_out.sql') on conflict (name) do nothing;
