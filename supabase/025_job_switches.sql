-- =====================================================================
-- DinerAI: the switches each scheduled job ran with
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds a column, and the
-- code records runs without it until it exists).
-- =====================================================================

-- Which switches were on for each run (EMAIL_REDIRECT, TEST_TOOLS, GOOGLE_MODE,
-- AGENTS_LIVE_ALLOWED; see src/lib/switches.ts), shown on /log for the builder.
alter table job_runs add column if not exists switches jsonb;

insert into schema_migrations (name) values ('025_job_switches.sql') on conflict (name) do nothing;
