-- Undoes 058_business_review.sql. Only once no code reads these tables and
-- columns (the code before 058 doesn't). Drafts the review made stay, without
-- their link to it; profile_fix drafts must be gone first (the old kind list
-- doesn't allow them): delete or skip them before running this.

delete from jobs where type in ('business_review', 'business_review_part', 'business_review_send', 'review_reply_release', 'business_review_receipt');
delete from job_types where type in ('business_review', 'business_review_part', 'business_review_send', 'review_reply_release', 'business_review_receipt');

alter table drafts drop column if exists business_review_id;
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice', 'rota'));

drop table if exists business_review_parts;
drop table if exists business_reviews;
drop table if exists review_tags;
drop table if exists rival_places;
drop table if exists calendar_events;
drop table if exists time_saved_log;
alter table restaurants drop column if exists dummy_google_profile;
alter table restaurants drop column if exists event_audiences;

delete from schema_migrations where name = '058_business_review.sql';
