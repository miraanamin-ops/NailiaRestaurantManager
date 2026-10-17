-- =====================================================================
-- DinerAI operations data, part 4 of 8: costs, targets and deal outcomes
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- Money is whole pence; quantities are in the ingredient's unit (g, ml, each).
-- =====================================================================

-- 1. Suppliers.
create table if not exists suppliers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  name           text not null,
  category       text,                                    -- "meat", "veg", "cash and carry"...
  notes          text,
  source         ops_source not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index if not exists suppliers_name_idx on suppliers (restaurant_id, ops_name_key(name));

-- 2. Invoices, read from a photo (kept in the private sales-files bucket) or typed,
--    and their lines, each matched to an ingredient.
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  supplier_id     uuid,
  invoice_number  text,
  invoice_date    date,
  net_pence       bigint,
  vat_pence       bigint,
  gross_pence     bigint,
  photo_path      text,                                   -- in the private sales-files bucket
  media_type      text,
  read            jsonb,                                  -- exactly what the AI read, for checking later
  status          text not null default 'needs_confirm' check (status in ('needs_confirm', 'saved', 'discarded', 'unreadable')),
  source          ops_source not null,
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (supplier_id, restaurant_id) references suppliers (id, restaurant_id)
);
create index if not exists invoices_restaurant_idx on invoices (restaurant_id, invoice_date desc);
create unique index if not exists invoices_one_saved_idx on invoices (restaurant_id, supplier_id, invoice_number)
  where status = 'saved' and invoice_number is not null;

create table if not exists invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  invoice_id        uuid not null,
  position          int not null default 0,
  description       text not null,                        -- as printed: "Chicken thigh boneless 5kg"
  quantity          numeric(12, 3),                       -- as printed: 2
  unit_text         text,                                 -- as printed: "x 5kg", "case", "each"
  quantity_std      numeric(14, 3),                       -- in the ingredient's unit: 10000 (g)
  line_net_pence    bigint,
  vat_pence         bigint,
  ingredient_id     uuid,
  match_confidence  numeric(4, 3) check (match_confidence between 0 and 1),
  match_method      text check (match_method in ('exact', 'fuzzy', 'ai', 'owner')),
  confirmed_at      timestamptz,
  confirmed_by      text,
  created_at        timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (invoice_id, restaurant_id) references invoices (id, restaurant_id) on delete cascade,
  foreign key (ingredient_id, restaurant_id) references ingredients (id, restaurant_id)
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);
create index if not exists invoice_lines_ingredient_idx on invoice_lines (restaurant_id, ingredient_id);

-- 3. Ingredient prices over time (history pattern): price_pence for pack_quantity
--    of the ingredient's unit (1250p for 1000 g), so both stay whole numbers.
create table if not exists ingredient_prices (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  ingredient_id    uuid not null,
  price_pence      int not null check (price_pence >= 0),
  pack_quantity    numeric(14, 3) not null check (pack_quantity > 0),
  effective_from   date not null,
  recorded_at      timestamptz not null default now(),
  supplier_id      uuid,
  invoice_line_id  uuid,
  source           ops_source not null,
  confirmed_at     timestamptz,
  confirmed_by     text,
  created_at       timestamptz not null default now(),
  foreign key (ingredient_id, restaurant_id) references ingredients (id, restaurant_id) on delete cascade,
  foreign key (supplier_id, restaurant_id) references suppliers (id, restaurant_id),
  foreign key (invoice_line_id, restaurant_id) references invoice_lines (id, restaurant_id) on delete set null (invoice_line_id)
);
create index if not exists ingredient_prices_idx on ingredient_prices (ingredient_id, effective_from desc, recorded_at desc);

-- Pence per unit (g, ml or each) of an ingredient on a day, as known at a moment.
create or replace function ingredient_price_on(p_ingredient_id uuid, p_day date, p_known_at timestamptz default null) returns numeric
language sql stable set search_path = public as $$
  select price_pence::numeric / pack_quantity from ingredient_prices
   where ingredient_id = p_ingredient_id and effective_from <= p_day and recorded_at <= coalesce(p_known_at, 'infinity'::timestamptz)
   order by effective_from desc, recorded_at desc, created_at desc
   limit 1
$$;

-- 4. Fixed costs (rent, rates...): a set of items, each from a date until it ends.
create table if not exists fixed_costs (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  name            text not null,
  category        text not null check (category in ('rent', 'business_rates', 'utilities', 'insurance', 'loan', 'subscriptions', 'salaries', 'other')),
  amount_pence    bigint not null check (amount_pence >= 0),
  frequency       text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly', 'one_off')),
  effective_from  date not null,
  effective_to    date,                                   -- no longer paid from this day
  recorded_at     timestamptz not null default now(),
  notes           text,
  source          ops_source not null default 'manual',
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists fixed_costs_restaurant_idx on fixed_costs (restaurant_id, effective_from);

-- 5. Targets over time (history pattern). Percentages as 28.50 = 28.5%.
create table if not exists targets (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  metric          text not null check (metric in ('labour_pct', 'food_cost_pct', 'prime_cost_pct', 'weekly_sales_pence', 'daily_sales_pence')),
  value           numeric(14, 2) not null check (value >= 0),
  effective_from  date not null,
  recorded_at     timestamptz not null default now(),
  source          ops_source not null default 'manual',
  created_at      timestamptz not null default now()
);
create index if not exists targets_idx on targets (restaurant_id, metric, effective_from desc, recorded_at desc);

create or replace function target_on(p_restaurant_id uuid, p_metric text, p_day date, p_known_at timestamptz default null) returns numeric
language sql stable set search_path = public as $$
  select value from targets
   where restaurant_id = p_restaurant_id and metric = p_metric and effective_from <= p_day
     and recorded_at <= coalesce(p_known_at, 'infinity'::timestamptz)
   order by effective_from desc, recorded_at desc, created_at desc
   limit 1
$$;

-- 6. Deals. The terms already live on campaigns.offer_details (023_growth.sql);
--    analytics.deals flattens them. Outcomes: what we expected when the owner
--    approved it, and what was measured after (more than one measurement may
--    exist, e.g. with a better method; none is overwritten).
create unique index if not exists campaigns_id_restaurant_idx on campaigns (id, restaurant_id);

create table if not exists deal_outcomes (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  campaign_id          uuid,
  restaurant_event_id  uuid,                              -- an in-store promotion with no campaign (034)
  kind                 text not null check (kind in ('expected', 'measured')),
  uplift_pence         bigint,
  uplift_pct           numeric(7, 2),
  extra_covers         int,
  window_start         date,
  window_end           date,
  method               text not null,                     -- "past results quoted", "same weekdays, 4 weeks before", "forecast vs actual"...
  model_run_id         uuid,                              -- (035)
  notes                text,
  recorded_at          timestamptz not null default now(),
  source               ops_source not null default 'model',
  created_at           timestamptz not null default now(),
  foreign key (campaign_id, restaurant_id) references campaigns (id, restaurant_id) on delete cascade,
  check (campaign_id is not null or restaurant_event_id is not null),
  check (window_end is null or window_start is null or window_end >= window_start)
);
create index if not exists deal_outcomes_campaign_idx on deal_outcomes (restaurant_id, campaign_id, recorded_at desc);

-- 7. RLS (030). Deal outcomes are written by the app or the models (model_writer may add).
select ops_apply_policies('suppliers', 'owned');
select ops_apply_policies('invoices', 'owned');
select ops_apply_policies('invoice_lines', 'owned');
select ops_apply_policies('ingredient_prices', 'append');
select ops_apply_policies('fixed_costs', 'owned');
select ops_apply_policies('targets', 'append');
select ops_apply_policies('deal_outcomes', 'output');

insert into schema_migrations (name) values ('033_ops_costs_deals.sql') on conflict (name) do nothing;
