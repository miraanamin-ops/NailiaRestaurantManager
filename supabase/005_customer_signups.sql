-- =====================================================================
-- Naila step 5: customer email sign-ups, rewards and consent
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- =====================================================================

-- Restaurant: public page address, branding and the sign-up reward.
alter table restaurants add column if not exists slug          text;
alter table restaurants add column if not exists signup_reward text;
alter table restaurants add column if not exists brand_color   text not null default '#c2410c';  -- buttons and accents
alter table restaurants add column if not exists brand_dark    text not null default '#1c1917';  -- headers and text
alter table restaurants add column if not exists tagline       text;
create unique index if not exists restaurants_slug_idx on restaurants (slug);

update restaurants
set slug = coalesce(slug, 'ember-spice'),
    tagline = coalesce(tagline, 'Halal charcoal grill · Whitechapel'),
    signup_reward = coalesce(signup_reward, 'a free Mango Lassi')
where id = '11111111-1111-1111-1111-111111111111';

-- Customers: email sign-ups live alongside the dummy customers.
alter table customers add column if not exists source            text not null default 'seed';  -- 'seed' or 'signup'
alter table customers add column if not exists unsubscribe_token text;
alter table customers add column if not exists unsubscribed_at   timestamptz;
create unique index if not exists customers_email_per_restaurant on customers (restaurant_id, lower(email));
create unique index if not exists customers_unsubscribe_token_idx on customers (unsubscribe_token);

-- Every consent decision, exactly as shown, so it can be proven later.
create table if not exists consents (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  customer_id       uuid references customers(id) on delete set null,
  email             text not null,
  granted           boolean not null,          -- true = ticked / opted in, false = not ticked or unsubscribed
  wording           text not null,             -- the exact sentence shown next to the checkbox
  form_version      text not null,             -- e.g. 'signup-v1'
  privacy_version   text,                      -- the privacy notice version linked from the form
  source            text not null,             -- 'signup_form' or 'unsubscribe_link'
  user_agent        text,
  created_at        timestamptz not null default now()
);
create index if not exists consents_customer_idx on consents (customer_id, created_at desc);

-- One-time rewards. The token is the secret part of the "Show at the till" link.
create table if not exists rewards (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  token          text not null unique,
  reward         text not null,               -- copied from the restaurant at sign-up time
  redeemed_at    timestamptz,                 -- when "Redeem now" was tapped
  expires_at     timestamptz,                 -- redeemed_at + 10 minutes
  created_at     timestamptz not null default now()
);
create unique index if not exists rewards_one_per_customer on rewards (customer_id);

-- Activity log for the dashboard: sign-ups, emails, redemptions, unsubscribes.
create table if not exists customer_events (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  type           text not null check (type in ('signup', 'repeat_signup', 'welcome_email_sent', 'email_failed', 'redeemed', 'unsubscribed')),
  detail         text,
  created_at     timestamptz not null default now()
);
create index if not exists customer_events_idx on customer_events (restaurant_id, created_at desc);

alter table consents        enable row level security;
alter table rewards         enable row level security;
alter table customer_events enable row level security;
