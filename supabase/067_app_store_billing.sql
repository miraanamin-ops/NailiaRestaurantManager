-- 067: paying in the app (step 50, phase 4). Safe to re-run.
--
-- A restaurant can pay by Stripe (the website) or by an App Store / Google Play
-- subscription (the app, through RevenueCat). Both feed the same access rule
-- (src/lib/billing/access.ts): trialing, active or a failed payment keep it running.
-- The store subscription is kept in its own columns, next to Stripe's, so neither
-- ever overwrites the other.

-- 1. The store subscription, as RevenueCat's webhook last told us.
alter table restaurants add column if not exists store_status text;                  -- trialing | active | past_due | expired
alter table restaurants add column if not exists store_platform text;                -- app_store | play_store
alter table restaurants add column if not exists store_product_id text;
alter table restaurants add column if not exists store_period_end timestamptz;       -- the free month's end, or the paid month's
alter table restaurants add column if not exists store_cancel_at_period_end boolean;
alter table restaurants add column if not exists store_environment text;             -- PRODUCTION | SANDBOX (test purchases, App Review)
alter table restaurants add column if not exists store_event_at timestamptz;         -- the newest event applied (older ones never undo it)

-- The restaurant uses the app (signed up or set up in it): with no WhatsApp number,
-- its messages go to the app (notifications and Chat) and setup can finish without
-- linking WhatsApp.
alter table restaurants add column if not exists app_since timestamptz;

-- 2. RevenueCat events already handled: it can send the same event more than once.
create table if not exists revenuecat_events (
  id             text primary key,             -- RevenueCat's event id
  type           text not null,
  restaurant_id  uuid references restaurants(id) on delete set null,
  received_at    timestamptz not null default now()
);
alter table revenuecat_events enable row level security;

-- 3. FOUNDER on Google Play: Play has no discount codes, so the app checks the code
--    with us and then buys Google's founder offer. One place per restaurant, 50 in all
--    (Apple's FOUNDER offer code has its own limit of 50, set in App Store Connect).
create table if not exists founder_claims (
  restaurant_id  uuid primary key references restaurants(id) on delete cascade,
  platform       text not null,
  claimed_at     timestamptz not null default now()
);
alter table founder_claims enable row level security;

insert into schema_migrations (name) values ('067_app_store_billing.sql') on conflict (name) do nothing;
