-- =====================================================================
-- Naila step 9b: remove a column nothing uses any more
-- Run this only AFTER the step 9 code is live on Vercel (the older code
-- still writes to this column).
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run more than once.
-- =====================================================================

-- Unused since step 8 (the morning brief replaced the 12-hour reminders).
alter table drafts drop column if exists reminded_at;

insert into schema_migrations (name) values ('010_drop_unused.sql') on conflict (name) do nothing;
