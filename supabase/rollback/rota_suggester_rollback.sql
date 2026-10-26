-- =====================================================================
-- DinerAI: ROLLBACK of 045_rota_suggester.sql. Only if you go back to the code
-- from before the rota suggester: revert that commit first.
-- Paste this into Supabase > SQL Editor and click "Run". Safe to run twice.
--
-- It deletes rota drafts, the suggester's columns on rota_weeks (edits,
-- summaries, published links), the rota settings and the Thursday job type.
-- Rotas and shifts themselves (032) stay.
-- =====================================================================

begin;

delete from jobs where type = 'rota_week';
delete from job_types where type = 'rota_week';
alter table rota_weeks drop column if exists adjustments;
alter table rota_weeks drop column if exists summary;
alter table rota_weeks drop column if exists draft_id;
alter table rota_weeks drop column if exists share_token;
alter table restaurants drop column if exists rota_settings;
delete from drafts where kind = 'rota';
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice'));
delete from schema_migrations where name = '045_rota_suggester.sql';

commit;
