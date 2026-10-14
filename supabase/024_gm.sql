-- =====================================================================
-- DinerAI agent organisation, phase 4: the GM (and Growth's send time)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Growth's send time: an approved campaign waits until then (still inside the
--    sending hours, and through the gate when it goes). Empty = send at approval.
alter table campaigns add column if not exists send_at timestamptz;

-- 2. "scheduled" is a reason a send is held (until the campaign's send time).
alter table blocked_sends drop constraint if exists blocked_sends_reason_check;
alter table blocked_sends add constraint blocked_sends_reason_check
  check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window', 'no_recipients', 'trust_level', 'test_mode', 'weekly_limit', 'scheduled'));

-- 3. New kinds of card the GM brings to the owner (none of them is ever sent to anyone):
--    profile_change  a fact about the restaurant to confirm before it's saved ("we close at 10 now")
--    agent_question  a question from scheduled work (Growth: which date is Eid? Insights: send Saturday's till report)
--    special_idea    a special the kitchen could make (Draft only: Like it / Skip)
--    choice          "Did you mean...?" with 2 or 3 buttons, for an unclear message
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice'));

-- 4. Alerts the GM holds: during quiet hours, or within an hour of the last alert.
--    Each goes out when it's due (the hourly job), never more than one an hour.
create table if not exists owner_alerts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  draft_id       uuid references drafts(id) on delete set null,
  text           text not null,
  reason         text not null check (reason in ('quiet_hours', 'hourly_limit', 'sent')),
  due_at         timestamptz not null,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists owner_alerts_due_idx on owner_alerts (restaurant_id, sent_at, due_at);
alter table owner_alerts enable row level security;

insert into schema_migrations (name) values ('024_gm.sql') on conflict (name) do nothing;
