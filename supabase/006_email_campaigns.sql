-- =====================================================================
-- Naila step 6: email campaigns
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- Drafts can now be email campaigns.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'birthday', 'promotion', 'other', 'email_campaign'));

-- Owner's email and test mode. In test mode only the owner gets a real email;
-- every customer in the segment is logged as "simulated".
alter table restaurants add column if not exists owner_email     text;
alter table restaurants add column if not exists email_test_mode boolean not null default true;
alter table restaurants add column if not exists last_birthday_campaign_on date;  -- Monday birthday draft guard

-- One campaign per draft: the structured email behind the WhatsApp preview.
create table if not exists campaigns (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  draft_id        uuid not null unique references drafts(id) on delete cascade,
  name            text not null,                -- e.g. "Quiet Thursday grill deal"
  subject         text not null,
  body            text not null,                -- may contain {first_name}
  offer           text not null,                -- e.g. "20% off all grills"
  valid_from      date not null,                -- London dates, inclusive
  valid_until     date not null,
  segment         text not null check (segment in ('everyone', 'birthdays_7d', 'unredeemed_signups')),
  is_birthday     boolean not null default false,
  sent_at         timestamptz,
  eligible_count  int,                          -- in the segment with valid consent
  excluded_count  int,                          -- in the segment but no consent / unsubscribed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists campaigns_restaurant_idx on campaigns (restaurant_id, created_at desc);

-- One row per recipient, each with its own one-time offer link.
create table if not exists campaign_sends (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  email          text not null,
  token          text not null unique,
  kind           text not null default 'customer' check (kind in ('customer', 'owner_copy')),
  delivery       text not null check (delivery in ('email', 'simulated', 'failed')),
  resend_id      text,
  error          text,
  opened_at      timestamptz,
  clicked_at     timestamptz,
  redeemed_at    timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);
-- No customer can get the same campaign twice.
create unique index if not exists campaign_sends_one_per_customer on campaign_sends (campaign_id, customer_id) where customer_id is not null;
create unique index if not exists campaign_sends_one_owner_copy on campaign_sends (campaign_id) where kind = 'owner_copy';
create index if not exists campaign_sends_campaign_idx on campaign_sends (campaign_id);

-- New reasons and events.
alter table blocked_sends drop constraint if exists blocked_sends_reason_check;
alter table blocked_sends add constraint blocked_sends_reason_check
  check (reason in ('not_approved', 'duplicate', 'discount_cap', 'paused', 'outside_window', 'no_recipients'));

alter table customer_events drop constraint if exists customer_events_type_check;
alter table customer_events add constraint customer_events_type_check
  check (type in ('signup', 'repeat_signup', 'welcome_email_sent', 'email_failed', 'redeemed', 'unsubscribed', 'offer_redeemed'));

alter table campaigns      enable row level security;
alter table campaign_sends enable row level security;
