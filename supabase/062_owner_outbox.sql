-- 062: WhatsApp outside the 24-hour window (step 46).
-- A message DinerAI sends the owner on its own (an alert, the rota, a report)
-- when they haven't messaged in 24 hours is held here, an approved template
-- ("Show me") opens the conversation, and the held messages go out on the
-- owner's next message or tap (src/lib/outbox.ts). Safe to re-run.

create table if not exists owner_outbox (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- { text, withButtons, mediaUrl, mediaCaption }: messageOwner's arguments.
  payload jsonb not null,
  opener text,          -- which template it asked for (brief, review, feedback, report, rota, update, none)
  sent_at timestamptz,  -- delivered after the owner messaged
  expired_at timestamptz -- too old to send (over 7 days)
);
create index if not exists owner_outbox_waiting on owner_outbox (restaurant_id, created_at) where sent_at is null and expired_at is null;

-- When the last opener template went out (at most one unanswered a day, except urgent alerts).
alter table restaurants add column if not exists last_opener_at timestamptz;

alter table owner_outbox enable row level security;

insert into schema_migrations (name) values ('062_owner_outbox.sql') on conflict (name) do nothing;
