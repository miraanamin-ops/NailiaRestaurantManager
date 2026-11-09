-- 064: importing a customer list (Part 4 of the help/advice work, 9 Nov 2026).
-- The owner uploads a CSV or Excel list (web or WhatsApp), checks a preview, says
-- how these people agreed to hear from them (opted in, or past customers given a
-- chance to opt out; "don't know" can't be imported) and declares it's true. Each
-- contact gets one welcome email the owner approves, sent in daily batches; no
-- campaign reaches them before it. Hard bounces and anyone who unsubscribed or
-- deleted their data are never added again (email_suppressions). Safe to re-run.

create table if not exists customer_imports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  channel text not null check (channel in ('web', 'whatsapp')),
  created_by text,                 -- the owner's email (web) or WhatsApp number
  file_name text,
  file_hash text not null,         -- sha256 of the uploaded file
  -- { email, name, phone, birthday }: column numbers in the file (null = not there)
  mapping jsonb not null,
  mapped_by text not null default 'rules' check (mapped_by in ('ai', 'rules')),
  rows_total integer not null default 0,
  rows_invalid integer not null default 0,     -- no valid email
  rows_duplicate integer not null default 0,   -- the same email twice in the file
  rows_existing integer not null default 0,    -- already on the restaurant's list
  rows_suppressed integer not null default 0,  -- unsubscribed, deleted their data, or hard-bounced before
  rows_to_add integer not null default 0,
  -- The cleaned rows, kept only until the owner confirms or cancels (then cleared).
  preview_rows jsonb,
  -- How these people agreed (the owner's choice) and their declaration that it's true.
  basis text check (basis in ('opted_in', 'past_customers')),
  declaration text,
  declared_by text,
  declared_at timestamptz,
  double_opt_in boolean not null default false,
  -- preview -> imported (welcome waiting for approval) -> sending -> done;
  -- cancelled (never imported), paused (bounce rate over 5%), undone (removed).
  status text not null default 'preview' check (status in ('preview', 'imported', 'sending', 'done', 'cancelled', 'paused', 'undone')),
  welcome_draft_id uuid references drafts (id) on delete set null,
  approved_at timestamptz,
  paused_reason text,
  undone_at timestamptz,
  rows_added integer not null default 0
);
create index if not exists customer_imports_restaurant on customer_imports (restaurant_id, created_at desc);
create index if not exists customer_imports_sending on customer_imports (status) where status = 'sending';

-- Every imported contact carries the basis, the declaration and the file it came from.
alter table customers add column if not exists import_id uuid references customer_imports (id) on delete set null;
alter table customers add column if not exists import_basis text;
alter table customers add column if not exists import_declared_by text;
alter table customers add column if not exists import_declared_at timestamptz;
alter table customers add column if not exists import_file_hash text;
-- not_contacted -> welcomed (campaigns may reach them), or awaiting_confirm (double opt-in) -> confirmed.
alter table customers add column if not exists import_status text check (import_status in ('not_contacted', 'welcomed', 'awaiting_confirm'));
alter table customers add column if not exists welcome_sent_at timestamptz;
alter table customers add column if not exists welcome_email_id text;
alter table customers add column if not exists bounced_at timestamptz;
create index if not exists customers_import on customers (import_id) where import_id is not null;
create index if not exists customers_welcome_due on customers (restaurant_id, import_status) where import_status = 'not_contacted';
create index if not exists customers_welcome_email on customers (welcome_email_id) where welcome_email_id is not null;

-- Addresses never to add or email again: per restaurant (unsubscribed, deleted their
-- data) or everywhere (a hard bounce: the address doesn't exist). Stored as a hash, so
-- a deleted customer's address isn't kept.
create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants (id) on delete cascade,
  email_hash text not null,
  reason text not null check (reason in ('unsubscribed', 'deleted', 'hard_bounce')),
  created_at timestamptz not null default now()
);
create unique index if not exists email_suppressions_unique on email_suppressions (coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), email_hash);

-- Everyone who has already unsubscribed is suppressed from today.
insert into email_suppressions (restaurant_id, email_hash, reason)
select restaurant_id, encode(sha256(convert_to(lower(trim(email)), 'UTF8')), 'hex'), 'unsubscribed'
from customers
where unsubscribed_at is not null and email is not null and deleted_at is null
on conflict do nothing;

-- The owner approves the welcome email before any imported contact hears from us.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice', 'rota', 'profile_fix', 'import_welcome'));

alter table customer_imports enable row level security;
alter table email_suppressions enable row level security;

insert into schema_migrations (name) values ('064_customer_imports.sql') on conflict (name) do nothing;
