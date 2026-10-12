-- =====================================================================
-- DinerAI agent organisation, phase 3b (first step): the owner's language
-- and quiet hours, two profile fields the GM will need (phase 4).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. The language messages to the owner are written in, in their own words
--    ("English", "English, with Urdu replies welcome"). Starts as English.
alter table restaurants add column if not exists owner_language text not null default 'English';

-- 2. Quiet hours: no alerts to the owner between these times (UK time). They can
--    run over midnight (11pm to 9am, the default). Alerts due then wait until they end.
alter table restaurants add column if not exists quiet_hours_start time not null default '23:00';
alter table restaurants add column if not exists quiet_hours_end   time not null default '09:00';

insert into schema_migrations (name) values ('022_owner_preferences.sql') on conflict (name) do nothing;
