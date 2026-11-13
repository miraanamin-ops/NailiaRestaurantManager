-- 070: the founder dashboard (/admin, step 52).
--
--   ai_usage          every Claude call: restaurant, what it was for, tokens, cost.
--                     Written from one place (lib/claude.ts), so nothing is missed.
--   billing_history   every change in a restaurant's billing standing (trial started,
--                     paying, payment failed, ended, closed) and every payment, from
--                     the Stripe and RevenueCat webhooks and account closing. Churn,
--                     conversion and retention are counted from it.
--   founder_costs     fixed monthly bills typed in on /admin/costs (Vercel, Supabase...).
--   founder_settings  prices used for estimates (dollar rate, per message, per email).
--   builder_alerts.restaurant_id  which restaurant an alert is about, when known.
--
-- ai_usage and billing_history have NO foreign key to restaurants on purpose: a
-- closed account's restaurant row is deleted, but its anonymous costs and billing
-- events must stay, or churn and total cost would be undercounted. They hold no
-- names, emails or messages.
--
-- Safe to re-run. Rollback: supabase/rollback/founder_dashboard_rollback.sql.

create table if not exists ai_usage (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  restaurant_id  uuid,                     -- null: not about one restaurant (or unknown)
  purpose        text not null,            -- e.g. 'assistant', 'agent:reputation', 'sales', 'onboarding'
  job_type       text,                     -- the queue job it ran in, if any
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cache_read     int not null default 0,
  cache_write    int not null default 0,
  cost_usd       numeric(12, 6) not null default 0
);
create index if not exists ai_usage_created_idx on ai_usage (created_at);
create index if not exists ai_usage_restaurant_idx on ai_usage (restaurant_id, created_at);
alter table ai_usage enable row level security;

create table if not exists billing_history (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null,
  at             timestamptz not null,
  -- stripe | app_store | play_store | closure | backfill | system
  source         text not null,
  -- standing: the billing standing changed to `standing`; payment: money received (amount_pence)
  kind           text not null check (kind in ('standing', 'payment')),
  -- exempt | pilot | trialing | active | past_due | none | ended | closed (lib/billing/access.ts, plus closed)
  standing       text,
  amount_pence   int,                      -- what the customer paid, VAT included
  tax_pence      int,
  discount_pence int,
  store_fee_pence int,                     -- Apple / Google's cut (15%), estimated
  currency       text,
  cancel_reason  text,                     -- Stripe's cancellation feedback, or the store's reason
  detail         text,
  external_id    text unique,              -- Stripe invoice / event id, so a repeat is never counted twice
  created_at     timestamptz not null default now()
);
create index if not exists billing_history_restaurant_idx on billing_history (restaurant_id, at);
create index if not exists billing_history_at_idx on billing_history (at);
alter table billing_history enable row level security;

create table if not exists founder_costs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  monthly_pence  int not null check (monthly_pence >= 0),
  starts_on      date not null default current_date,
  ends_on        date,
  note           text,
  created_at     timestamptz not null default now()
);
alter table founder_costs enable row level security;

create table if not exists founder_settings (
  key            text primary key,
  value          jsonb not null,
  updated_at     timestamptz not null default now()
);
alter table founder_settings enable row level security;

alter table builder_alerts add column if not exists restaurant_id uuid;
create index if not exists builder_alerts_restaurant_idx on builder_alerts (restaurant_id, created_at);

-- Where every restaurant stands today, as its first line of history (only for
-- restaurants with none yet). The same rule as billingStanding in lib/billing/access.ts.
-- scripts/founder-backfill-stripe.mjs replaces these with Stripe's real dates.
insert into billing_history (restaurant_id, at, source, kind, standing, detail)
select r.id,
       coalesce(r.app_since, r.created_at),
       'backfill',
       'standing',
       case
         when r.billing_exempt then 'exempt'
         when r.pilot_invite_code is not null then 'pilot'
         when r.subscription_status in ('trialing', 'active', 'past_due') then r.subscription_status
         when r.store_status in ('trialing', 'active', 'past_due') then r.store_status
         when r.subscription_status is not null or r.store_status is not null then 'ended'
         else 'none'
       end,
       'Where it stood when the founder dashboard started'
from restaurants r
where not exists (select 1 from billing_history h where h.restaurant_id = r.id);

-- Sums for the dashboard, done in the database so it never loads every row.
-- Claude cost per month, restaurant and purpose. Before ai_usage started, the two
-- older cost records (agent jobs, Dina's setup) stand in for it; after, ai_usage
-- already includes them, so they're left out (never counted twice).
create or replace function founder_monthly_costs(p_since timestamptz)
returns table (month date, restaurant_id uuid, purpose text, calls bigint, cost_usd numeric)
language sql stable as $$
  with cut as (select coalesce(min(created_at), 'infinity'::timestamptz) as t from ai_usage)
  select date_trunc('month', u.created_at)::date, u.restaurant_id, u.purpose, count(*), sum(u.cost_usd)
    from ai_usage u where u.created_at >= p_since group by 1, 2, 3
  union all
  select date_trunc('month', j.created_at)::date, j.restaurant_id, 'agent:' || j.agent, count(*), sum(j.cost_usd)
    from agent_jobs j, cut where j.created_at >= p_since and j.created_at < cut.t and j.cost_usd is not null group by 1, 2, 3
  union all
  select date_trunc('month', o.created_at)::date, o.restaurant_id, 'onboarding:dina', count(*), sum(o.cost_usd)
    from onboarding_ai_usage o, cut where o.created_at >= p_since and o.created_at < cut.t group by 1, 2, 3;
$$;

-- What each restaurant did per month: messages (WhatsApp or app), emails really
-- sent, approvals, skips and edits. One row per month, restaurant and metric.
create or replace function founder_monthly_activity(p_since timestamptz)
returns table (month date, restaurant_id uuid, metric text, n bigint)
language sql stable as $$
  select date_trunc('month', created_at)::date, restaurant_id,
         case when direction = 'inbound' then 'owner_in' when app is not null then 'app_out' else 'whatsapp_out' end, count(*)
    from messages where created_at >= p_since and restaurant_id is not null group by 1, 2, 3
  union all
  select date_trunc('month', sent_at)::date, restaurant_id, 'emails', count(*)
    from sent_log where sent_at >= p_since and channel = 'email' and simulated = false group by 1, 2
  union all
  select date_trunc('month', approved_at)::date, restaurant_id, 'approvals', count(*)
    from drafts where approved_at >= p_since group by 1, 2
  union all
  select date_trunc('month', updated_at)::date, restaurant_id, 'skips', count(*)
    from drafts where updated_at >= p_since and status = 'rejected' group by 1, 2
  union all
  select date_trunc('month', updated_at)::date, restaurant_id, 'edits', count(*)
    from drafts where updated_at >= p_since and version > 1 group by 1, 2
  union all
  select date_trunc('month', logged_at)::date, restaurant_id, 'minutes_saved', sum(minutes)
    from time_saved_log where logged_at >= p_since and status = 'done' group by 1, 2;
$$;

-- When each restaurant's owner was last active (a message, tap or approval) and
-- first approved anything.
create or replace function founder_last_activity()
returns table (restaurant_id uuid, last_in timestamptz, last_approval timestamptz, first_approval timestamptz)
language sql stable as $$
  select r.id,
         (select max(m.created_at) from messages m where m.restaurant_id = r.id and m.direction = 'inbound'),
         (select max(d.approved_at) from drafts d where d.restaurant_id = r.id),
         (select min(d.approved_at) from drafts d where d.restaurant_id = r.id)
  from restaurants r;
$$;

revoke all on function founder_monthly_costs(timestamptz) from public, anon, authenticated;
revoke all on function founder_monthly_activity(timestamptz) from public, anon, authenticated;
revoke all on function founder_last_activity() from public, anon, authenticated;
grant execute on function founder_monthly_costs(timestamptz) to service_role;
grant execute on function founder_monthly_activity(timestamptz) to service_role;
grant execute on function founder_last_activity() to service_role;

insert into schema_migrations (name) values ('070_founder_dashboard.sql') on conflict (name) do nothing;
