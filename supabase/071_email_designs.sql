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
-- Safe to re-run. Rollback: alter table campaigns drop column if exists email_design; and
-- the drafts_kind_check from 064 (without 'photo_request'), once no such draft is left.

alter table campaigns add column if not exists email_design jsonb;

-- The photo "part 2" (phase 4): after the owner approves an offer email about a dish
-- with no photo, a photo_request card asks for one; the email waits (at most 3 hours,
-- or its own send time) and goes either way. email_design.photo_ask records the wait.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice', 'rota', 'profile_fix', 'import_welcome', 'photo_request'));

insert into schema_migrations (name) values ('071_email_designs.sql') on conflict (name) do nothing;
