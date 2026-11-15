-- 071: customer email designs (phase 3 of the Inbox and emails plan, 15 Nov 2026).
--
--   campaigns.email_design  which design draws the campaign's email, saved when it's
--                           drafted so the preview the owner approves is the email
--                           that goes: { "family": "discount" | "occasion" | "quiet"
--                           | "new_dish" | "birthday", "look": "photo_hero" | ...,
--                           "photo_url": "https://..." | null }. The looks take turns
--                           per restaurant (lib/email/designs.ts); "Try another look"
--                           in the app changes it. Null: a steady choice from the id.
--
-- Safe to re-run. Rollback: alter table campaigns drop column if exists email_design;

alter table campaigns add column if not exists email_design jsonb;

insert into schema_migrations (name) values ('071_email_designs.sql') on conflict (name) do nothing;
