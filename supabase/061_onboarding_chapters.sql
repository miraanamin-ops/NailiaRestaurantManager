-- 061: onboarding in chapters (CLAUDE.md step 45; the owner's plan of 7 Nov 2026).
-- What setup now asks that had nowhere to live: how the restaurant serves, the
-- owner's goals, links, size and spend, who its customers are, days never to
-- discount, the weekly sales target and quiet/busy days, the customers'
-- languages, holiday closures, how the owner likes messages; and, for an
-- imported customer list, how those customers agreed to marketing.
-- Safe to re-run, and safe before the new code is live (it only adds columns).

alter table restaurants add column if not exists venue_types text[];          -- dine_in, takeaway, delivery
alter table restaurants add column if not exists goals text[];                -- up to 3 (guide/cards.ts GOALS)
alter table restaurants add column if not exists instagram text;
alter table restaurants add column if not exists ordering_url text;
alter table restaurants add column if not exists booking_url text;
alter table restaurants add column if not exists seats text;                  -- a band: "under_30", "30_60", ...
alter table restaurants add column if not exists avg_spend text;              -- a band per head: "under_15", ...
alter table restaurants add column if not exists customer_types text[];       -- families, students, ...
alter table restaurants add column if not exists no_discount_days text[];     -- monday ... sunday
alter table restaurants add column if not exists weekly_sales_target int;     -- pounds, net of VAT
alter table restaurants add column if not exists quiet_days text[];
alter table restaurants add column if not exists busy_days text[];
alter table restaurants add column if not exists customer_languages text[];
alter table restaurants add column if not exists closures_note text;
alter table restaurants add column if not exists message_style text;          -- short or detailed

do $$ begin
  alter table restaurants add constraint restaurants_weekly_sales_target_range check (weekly_sales_target is null or weekly_sales_target between 0 and 10000000);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table restaurants add constraint restaurants_message_style_check check (message_style is null or message_style in ('short', 'detailed'));
exception when duplicate_object then null;
end $$;

-- An imported customer: how the owner says they agreed to marketing (kept with
-- the customer). They only get marketing after confirming by email, like anyone.
alter table customers add column if not exists consent_basis text;

insert into schema_migrations (name) values ('061_onboarding_chapters.sql') on conflict (name) do nothing;
