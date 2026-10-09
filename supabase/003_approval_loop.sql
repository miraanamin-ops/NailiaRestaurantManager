-- =====================================================================
-- Naila step 3: draft approval loop
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- Drafts: new statuses, and what the assistant is waiting for from the owner.
alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check
  check (status in ('pending', 'approved', 'skipped', 'superseded', 'rejected', 'sent'));

alter table drafts add column if not exists waiting_for text
  check (waiting_for in ('decision', 'edit_instructions', 'skip_reason'));
alter table drafts add column if not exists audience text;      -- who it would go to, e.g. "Google review by Peter W."
alter table drafts add column if not exists request text;       -- what the owner asked for
alter table drafts add column if not exists version int not null default 1;

create index if not exists drafts_waiting_idx on drafts (restaurant_id, created_at desc) where waiting_for is not null;

-- Nothing is really sent yet, so every sent_log row is marked as simulated.
alter table sent_log add column if not exists simulated boolean not null default true;

-- Every edit and skip reason, so future drafts can learn the owner's taste.
create table if not exists draft_feedback (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  draft_id        uuid references drafts(id) on delete set null,
  draft_kind      text,
  kind            text not null check (kind in ('edit', 'skip')),
  note            text not null,     -- the edit instruction or the skip reason
  before_content  text,
  after_content   text,              -- only for edits
  created_at      timestamptz not null default now()
);

create index if not exists draft_feedback_idx on draft_feedback (restaurant_id, created_at desc);

alter table draft_feedback enable row level security;

-- Record that this file has been run (see scripts/check-schema.mjs).
insert into schema_migrations (name) values ('003_approval_loop.sql') on conflict (name) do nothing;
