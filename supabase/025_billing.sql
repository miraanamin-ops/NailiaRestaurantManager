-- =====================================================================
-- DinerAI paid sign-up: Stripe subscriptions and pilot invite codes
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Billing details on each restaurant (kept up to date by the Stripe webhook).
alter table restaurants add column if not exists stripe_customer_id text;
alter table restaurants add column if not exists stripe_subscription_id text;
-- trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused (Stripe's words)
alter table restaurants add column if not exists subscription_status text;
alter table restaurants add column if not exists trial_ends_at timestamptz;
alter table restaurants add column if not exists current_period_end timestamptz;
alter table restaurants add column if not exists cancel_at_period_end boolean not null default false;
alter table restaurants add column if not exists payment_failed_at timestamptz;
-- When the newest Stripe event we applied happened (older ones arriving late are ignored).
alter table restaurants add column if not exists billing_event_at timestamptz;
-- Restaurants that never pay through Stripe (everything that existed before billing).
alter table restaurants add column if not exists billing_exempt boolean not null default false;
-- The pilot invite code used to sign up (no card needed). Clear it to end the pilot.
alter table restaurants add column if not exists pilot_invite_code text;
alter table restaurants add column if not exists terms_accepted_at timestamptz;
alter table restaurants add column if not exists terms_version text;
create unique index if not exists restaurants_stripe_customer_idx on restaurants (stripe_customer_id) where stripe_customer_id is not null;

-- 2. Every restaurant that exists today keeps working without billing.
--    Runs only the first time this file is run, so later sign-ups are never exempted.
do $$
begin
  if not exists (select 1 from schema_migrations where name = '025_billing.sql') then
    update restaurants set billing_exempt = true;
  end if;
end $$;

-- 3. Stripe events already handled: Stripe can send the same event more than once.
create table if not exists stripe_events (
  id             text primary key,             -- Stripe's event id (evt_...)
  type           text not null,
  restaurant_id  uuid references restaurants(id) on delete set null,
  received_at    timestamptz not null default now()
);
alter table stripe_events enable row level security;

-- 4. Pilot invite codes: managed by the builder in Table Editor (add a row, set
--    max_uses, optional expires_at; untick active to stop new sign-ups with it).
--    A code lets a restaurant sign up without a card.
create table if not exists pilot_invites (
  code        text primary key check (code = upper(code)),
  note        text,                            -- who it's for
  max_uses    int not null default 1,
  used_count  int not null default 0,
  expires_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table pilot_invites enable row level security;

-- Uses one place on a code, if it has one left. Two people can't take the last place.
create or replace function claim_pilot_invite(p_code text) returns boolean
language sql as $$
  with claimed as (
    update pilot_invites
       set used_count = used_count + 1
     where code = upper(trim(p_code))
       and active
       and used_count < max_uses
       and (expires_at is null or expires_at > now())
    returning 1
  )
  select exists (select 1 from claimed);
$$;
-- Only the app's server (secret key) may call it.
revoke execute on function claim_pilot_invite(text) from public, anon, authenticated;
grant execute on function claim_pilot_invite(text) to service_role;

insert into schema_migrations (name) values ('025_billing.sql') on conflict (name) do nothing;
