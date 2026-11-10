-- 063: owner referrals (step 49). Each restaurant has a code to share; a new
-- restaurant that signs up with it records who recommended it, and once the new
-- one pays its first invoice the recommending restaurant gets one month free
-- (a £99 credit on its Stripe balance). Safe to re-run.

alter table restaurants add column if not exists referral_code text;
alter table restaurants add column if not exists referred_by uuid references restaurants (id) on delete set null;
alter table restaurants add column if not exists referral_credited_at timestamptz;

create unique index if not exists restaurants_referral_code_key on restaurants (referral_code) where referral_code is not null;
create index if not exists restaurants_referred_by on restaurants (referred_by) where referred_by is not null;

insert into schema_migrations (name) values ('063_referrals.sql') on conflict (name) do nothing;
