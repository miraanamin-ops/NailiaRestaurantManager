-- 068: which notifications the owner wants from the app (step 50, phase 5). Safe to re-run.
-- { "brief": true, "urgent": true, "updates": true, "reports": true, "nudge": true };
-- a kind set to false never buzzes the phone (the item still waits in the app's Inbox
-- or Chat). Missing or empty: everything on. Changed in the app's More > Settings.
alter table restaurants add column if not exists app_alerts jsonb;

insert into schema_migrations (name) values ('068_app_alerts.sql') on conflict (name) do nothing;
