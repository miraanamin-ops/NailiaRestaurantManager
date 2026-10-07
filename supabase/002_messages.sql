-- =====================================================================
-- Naila step 2: WhatsApp message log
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it doesn't touch your other tables.
-- =====================================================================

create table if not exists messages (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references restaurants(id) on delete cascade,
  direction      text not null check (direction in ('inbound', 'outbound')),
  from_number    text not null,          -- e.g. whatsapp:+447700900123
  to_number      text not null,
  body           text not null default '',
  twilio_sid     text,                   -- Twilio's ID for the message
  status         text not null default 'received' check (status in ('received', 'sent', 'failed')),
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists messages_from_idx on messages (from_number, created_at desc);
create index if not exists messages_to_idx   on messages (to_number, created_at desc);

alter table messages enable row level security;
