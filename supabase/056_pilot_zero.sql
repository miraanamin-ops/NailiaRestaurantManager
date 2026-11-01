-- 056: Pilot Zero (docs/pilot-zero.md). The builder goes through DinerAI as the
-- first real customer; everything here is off unless a restaurant is marked.
--   pilot_zero             the builder's own pilot restaurant (marked in the admin
--                          console, /onboarding/admin/pilot-zero; only a test
--                          restaurant or one on the builder's own number can be)
--   google_dry_run         Google review replies and posts: true = dry run (shown
--                          as "would have posted", nothing reaches Google), false
--                          = they go to Google, empty = dry run for a Pilot Zero
--                          restaurant, live for everyone else
--   google_profile_writes  hours and photos: for a Pilot Zero restaurant they stay
--                          dry run until this is true (and replies are live too)
-- All three are set only by the builder in the admin console, never by the owner,
-- WhatsApp, Dina or a profile edit (src/lib/gate-rules.ts googleDryRun).
-- Only adds columns, so the code before it keeps working. Safe to re-run.

alter table restaurants add column if not exists pilot_zero boolean not null default false;
alter table restaurants add column if not exists google_dry_run boolean;
alter table restaurants add column if not exists google_profile_writes boolean;

insert into schema_migrations (name) values ('056_pilot_zero.sql') on conflict (name) do nothing;
