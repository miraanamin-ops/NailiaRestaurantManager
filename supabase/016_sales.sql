-- =====================================================================
-- Naila step 15: sales data (till report photos, POS files) and weather
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Where each restaurant is (for its weather), and the weather job's markers.
alter table restaurants add column if not exists latitude              numeric(8, 5);
alter table restaurants add column if not exists longitude             numeric(8, 5);
alter table restaurants add column if not exists weather_backfilled_at timestamptz;  -- the last 12 months were fetched once
alter table restaurants add column if not exists last_weather_on       date;         -- the daily weather was stored for this London day

-- 2. Staff numbers: they can send till reports and sales files for one restaurant, nothing else.
create table if not exists staff_numbers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  whatsapp       text not null,                -- e.g. whatsapp:+447700900123
  added_at       timestamptz not null default now(),
  removed_at     timestamptz
);
-- A number can be staff for one restaurant at a time.
create unique index if not exists staff_numbers_active_idx on staff_numbers (whatsapp) where removed_at is null;
create index if not exists staff_numbers_restaurant_idx on staff_numbers (restaurant_id);
alter table staff_numbers enable row level security;

-- 3. End-of-day till reports ("Z-reports") read from photos. The photo is kept.
create table if not exists z_reports (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  business_date   date,                          -- the trading day the report is for
  gross_sales     numeric(10, 2),
  net_sales       numeric(10, 2),
  vat             numeric(10, 2),
  transactions    int,
  card            numeric(10, 2),
  cash            numeric(10, 2),
  other_payments  numeric(10, 2),
  discounts       numeric(10, 2),
  refunds         numeric(10, 2),
  hourly          jsonb,                         -- [{"hour": 17, "sales": 312.5}] if the report has it
  photo_path      text,                          -- in the private sales-files storage bucket
  media_type      text,
  read            jsonb,                         -- exactly what the AI read, for checking later
  problems        jsonb not null default '[]'::jsonb,  -- why it needed confirming
  status          text not null default 'needs_confirm'
                  check (status in ('saved', 'needs_confirm', 'needs_date', 'needs_replace', 'unreadable', 'discarded', 'replaced')),
  sent_by         text,                          -- the WhatsApp number that sent it
  sender_role     text not null default 'owner' check (sender_role in ('owner', 'staff', 'test')),
  is_dummy        boolean not null default false,
  saved_at        timestamptz,
  created_at      timestamptz not null default now()
);
-- Only one saved report per trading day (a second one replaces it).
create unique index if not exists z_reports_one_saved_per_day on z_reports (restaurant_id, business_date) where status = 'saved';
create index if not exists z_reports_restaurant_idx on z_reports (restaurant_id, created_at desc);
alter table z_reports enable row level security;

-- 4. Daily sales totals: one row per restaurant per day, from a till report, a POS file or dummy data.
create table if not exists sales_days (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  day             date not null,
  net_sales       numeric(10, 2) not null,       -- excluding VAT
  gross_sales     numeric(10, 2),                -- including VAT
  vat             numeric(10, 2),
  transactions    int,
  card            numeric(10, 2),
  cash            numeric(10, 2),
  discounts       numeric(10, 2),
  refunds         numeric(10, 2),
  net_estimated   boolean not null default false, -- POS files only give totals with VAT: net worked out at 20%
  source          text not null check (source in ('z_report', 'pos', 'seed')),
  z_report_id     uuid references z_reports(id) on delete set null,
  is_dummy        boolean not null default false,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (restaurant_id, day)
);
alter table sales_days enable row level security;

-- Sales by hour (London time), where the till report or POS file has it. Including VAT, as the till shows it.
create table if not exists sales_hours (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  day             date not null,
  hour            smallint not null check (hour between 0 and 23),
  sales           numeric(10, 2) not null,
  transactions    int,
  source          text not null check (source in ('z_report', 'pos', 'seed')),
  is_dummy        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (restaurant_id, day, hour)
);
alter table sales_hours enable row level security;

-- 5. POS exports (CSV or Excel). The first file in a new layout asks the owner to
--    confirm which column is which; the layout is saved so the next file just works.
create table if not exists pos_layouts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  signature      text not null,                 -- a fingerprint of the column headings
  headers        jsonb not null,
  mapping        jsonb not null,                -- which heading is the date, time, item, quantity, price
  pos_name       text,                          -- e.g. "Square", if the AI could tell
  confirmed_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (restaurant_id, signature)
);
alter table pos_layouts enable row level security;

create table if not exists pos_imports (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  file_path       text not null,                 -- the original file, in the private sales-files bucket
  file_name       text,
  file_type       text not null check (file_type in ('csv', 'xlsx')),
  signature       text,
  layout_id       uuid references pos_layouts(id) on delete set null,
  mapping         jsonb,                         -- the AI's suggestion, until the owner confirms it
  status          text not null default 'needs_mapping' check (status in ('needs_mapping', 'imported', 'failed', 'cancelled')),
  channel         text not null check (channel in ('web', 'whatsapp')),
  sent_by         text,
  rows_total      int,
  rows_imported   int,
  rows_duplicate  int,
  rows_skipped    int,
  first_day       date,
  last_day        date,
  total_amount    numeric(12, 2),
  error           text,
  imported_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists pos_imports_restaurant_idx on pos_imports (restaurant_id, created_at desc);
alter table pos_imports enable row level security;

-- Item-level sales. row_key is a fingerprint of the sale line, so the same
-- period uploaded twice is skipped instead of counted twice.
create table if not exists sales_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  day             date not null,
  hour            smallint check (hour between 0 and 23),
  item            text not null,
  quantity        numeric(10, 2) not null,
  amount          numeric(10, 2) not null,       -- line total, including VAT
  receipt         text,                          -- receipt / order number, to count sales
  import_id       uuid references pos_imports(id) on delete cascade,
  row_key         text not null,
  is_dummy        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (restaurant_id, row_key)
);
create index if not exists sales_items_day_idx on sales_items (restaurant_id, day);
alter table sales_items enable row level security;

-- 6. Daily weather at each restaurant (Open-Meteo), kept for forecasting later.
create table if not exists weather_days (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  day             date not null,
  temp_max        numeric(4, 1),
  temp_min        numeric(4, 1),
  temp_mean       numeric(4, 1),
  rain_mm         numeric(5, 1),                 -- all precipitation that day
  weather_code    smallint,                      -- WMO code
  conditions      text,                          -- e.g. "Light rain"
  source          text not null check (source in ('archive', 'recent', 'forecast')),
  fetched_at      timestamptz not null default now(),
  unique (restaurant_id, day)
);
alter table weather_days enable row level security;

-- 7. A private storage bucket for till report photos and POS files (never public links).
insert into storage.buckets (id, name, public)
values ('sales-files', 'sales-files', false)
on conflict (id) do nothing;

insert into schema_migrations (name) values ('016_sales.sql') on conflict (name) do nothing;
