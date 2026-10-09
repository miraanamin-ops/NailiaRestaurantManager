-- =====================================================================
-- Naila step 4: safety rules
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- Per-restaurant settings the rules use. Change them in Supabase's Table
-- Editor (restaurants table), or by WhatsApp with CAP / PAUSE / RESUME.
alter table restaurants add column if not exists discount_cap_percent int not null default 20
  check (discount_cap_percent between 0 and 100);
alter table restaurants add column if not exists send_window_start time not null default '09:00';
alter table restaurants add column if not exists send_window_end   time not null default '21:00';
alter table restaurants add column if not exists paused      boolean not null default false;
alter table restaurants add column if not exists paused_at   timestamptz;
alter table restaurants add column if not exists fake_now    timestamptz;  -- test clock set by "TIME 22:00"; null = real time
alter table restaurants add column if not exists owner_whatsapp text;      -- where reminders and reports go
alter table restaurants add column if not exists whatsapp_from  text;      -- the number we send from (sandbox)

-- Drafts: new statuses and timestamps for the send pipeline.
alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check
  check (status in ('pending', 'approved', 'queued', 'sent', 'blocked', 'skipped', 'superseded', 'rejected'));
alter table drafts add column if not exists approved_at   timestamptz;
alter table drafts add column if not exists scheduled_for timestamptz;  -- queued: earliest send time (null = waiting for RESUME)
alter table drafts add column if not exists sent_at       timestamptz;
alter table drafts add column if not exists block_reason  text;
alter table drafts add column if not exists reminded_at   timestamptz;
alter table drafts add column if not exists check_notes   jsonb;        -- what the checker fixed or flagged

-- Drafts approved in step 3 were already logged as sent: mark them sent.
update drafts d set status = 'sent', approved_at = coalesce(d.approved_at, d.updated_at), sent_at = coalesce(d.sent_at, d.updated_at)
where d.status = 'approved' and exists (select 1 from sent_log s where s.draft_id = d.id);

-- A draft can only ever appear once in the sent log, even if two sends race.
create unique index if not exists sent_log_one_per_draft on sent_log (draft_id) where draft_id is not null;

-- Every blocked or held-back send, with the reason.
create table if not exists blocked_sends (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  draft_id       uuid references drafts(id) on delete set null,
  reason         text not null check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window')),
  detail         text,
  created_at     timestamptz not null default now()
);
create index if not exists blocked_sends_idx on blocked_sends (restaurant_id, created_at desc);
alter table blocked_sends enable row level security;
