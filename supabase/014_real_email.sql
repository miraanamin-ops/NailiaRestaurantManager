-- =====================================================================
-- Naila step 13: real customer email (double opt-in, branded emails,
-- feedback emails, delete my data, rate limits)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- 1. Restaurant branding and email settings.
alter table restaurants add column if not exists logo_url        text;     -- shown at the top of every email
alter table restaurants add column if not exists reply_to_email  text;     -- where customers' replies go (default: owner_email)
alter table restaurants add column if not exists feedback_emails boolean not null default true;  -- "How was your visit?" emails

-- 2. Double opt-in: an email address only counts once its owner clicks the link we send.
alter table customers add column if not exists email_confirmed_at timestamptz;
alter table customers add column if not exists confirm_token      text;
alter table customers add column if not exists confirm_sent_at    timestamptz;
alter table customers add column if not exists deleted_at         timestamptz;  -- "delete my data": personal details removed
create unique index if not exists customers_confirm_token_idx on customers (confirm_token);

alter table consents add column if not exists confirmed_at timestamptz;  -- consent only counts once the email is confirmed

-- Everyone already in the database (all dummy or test data) counts as confirmed.
-- Only the first run does this, so later sign-ups are never confirmed by re-running the file.
do $$
begin
  if not exists (select 1 from schema_migrations where name = '014_real_email.sql') then
    update customers set email_confirmed_at = created_at where email_confirmed_at is null;
    update consents set confirmed_at = created_at where confirmed_at is null;
  end if;
end $$;

-- 3. Rate limits (sign-up form, feedback form, data requests). Each row is one attempt;
--    the key holds a hash, never the raw IP address or email. Old rows are cleared hourly.
create table if not exists rate_limits (
  id          bigint generated always as identity primary key,
  key         text not null,
  created_at  timestamptz not null default now()
);
create index if not exists rate_limits_key_idx on rate_limits (key, created_at desc);
alter table rate_limits enable row level security;

-- 4. "How was your visit?" emails, about 3 hours after a reward or offer is redeemed.
create table if not exists feedback_requests (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  source         text not null check (source in ('reward', 'offer')),
  source_id      uuid not null,                 -- the reward or campaign_send that was redeemed
  token          text not null unique,          -- the secret part of the feedback link
  due_at         timestamptz not null,          -- redeemed + 3 hours
  status         text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  detail         text,                          -- why it was skipped, or the error
  sent_at        timestamptz,
  resend_id      text,
  created_at     timestamptz not null default now()
);
create unique index if not exists feedback_requests_one_per_redemption on feedback_requests (source, source_id);
create index if not exists feedback_requests_due_idx on feedback_requests (status, due_at);
create index if not exists feedback_requests_customer_idx on feedback_requests (customer_id, sent_at desc);
alter table feedback_requests enable row level security;

-- Private feedback from the form. 1-3 stars go to the owner at once; 4-5 in the next morning brief.
create table if not exists feedback (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  request_id     uuid not null unique references feedback_requests(id) on delete cascade,
  rating         int not null check (rating between 1 and 5),
  comment        text,
  negative       boolean not null,
  alerted_at     timestamptz,                   -- negative: when the owner was told
  reported_at    timestamptz,                   -- positive: when it went into a brief
  created_at     timestamptz not null default now()
);
create index if not exists feedback_restaurant_idx on feedback (restaurant_id, created_at desc);
alter table feedback enable row level security;

-- 5. New customer events.
alter table customer_events drop constraint if exists customer_events_type_check;
alter table customer_events add constraint customer_events_type_check
  check (type in ('signup', 'repeat_signup', 'welcome_email_sent', 'email_failed', 'redeemed', 'unsubscribed', 'offer_redeemed',
                  'confirm_email_sent', 'email_confirmed', 'feedback_email_sent', 'feedback_received', 'data_deleted'));

-- 6. Real emails from now on: the old per-restaurant "email test mode" is no longer used.
--    (Dummy customers are never emailed; TEST_MODE redirects real ones to the builder.)
update restaurants set email_test_mode = false where email_test_mode;

-- 7. Repair text that an earlier paste saved garbled ("CafÃ©" instead of "Café", "Â·" instead of "·").
--    Only text containing those tell-tale patterns is touched, and only if it decodes cleanly.
create or replace function pg_temp.fix_garbled(t text) returns text language plpgsql as $$
begin
  if t is null or t !~ '(Ã|Â|â€|ðŸ)' then return t; end if;
  begin
    return convert_from(convert_to(t, 'WIN1252'), 'UTF8');
  exception when others then
    begin
      return convert_from(convert_to(t, 'LATIN1'), 'UTF8');
    exception when others then
      return t;
    end;
  end;
end $$;
update restaurants set name = pg_temp.fix_garbled(name), tagline = pg_temp.fix_garbled(tagline),
  address = pg_temp.fix_garbled(address), brand_voice = pg_temp.fix_garbled(brand_voice)
  where concat(name, tagline, address, brand_voice) ~ '(Ã|Â|â€|ðŸ)';
update customers set name = pg_temp.fix_garbled(name), notes = pg_temp.fix_garbled(notes)
  where concat(name, notes) ~ '(Ã|Â|â€|ðŸ)';
update reviews set text = pg_temp.fix_garbled(text), author_name = pg_temp.fix_garbled(author_name)
  where concat(text, author_name) ~ '(Ã|Â|â€|ðŸ)';

insert into schema_migrations (name) values ('014_real_email.sql') on conflict (name) do nothing;
