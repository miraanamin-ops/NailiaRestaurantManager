-- 059: menu engineering (lib/menu-engineering.ts). The owner's minimum profit on
-- a dish after any offer's discount, as a % of its price without VAT. Empty means
-- the recommended 50%. (Dish costs need no change: they're kept with each dish.)
-- Safe to re-run, and safe before the new code is live (it only adds a column).

alter table restaurants add column if not exists min_margin_pct int;
do $$ begin
  alter table restaurants add constraint restaurants_min_margin_pct_range check (min_margin_pct is null or (min_margin_pct between 0 and 90));
exception when duplicate_object then null;
end $$;

insert into schema_migrations (name) values ('059_min_margin.sql') on conflict (name) do nothing;
