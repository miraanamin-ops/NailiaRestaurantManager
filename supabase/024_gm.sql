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

insert into schema_migrations (name) values ('024_gm.sql') on conflict (name) do nothing;
