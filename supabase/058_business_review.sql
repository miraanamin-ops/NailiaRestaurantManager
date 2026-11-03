-- 058: the business review Dina sends straight after onboarding (src/lib/review/).
-- When setup finishes, one job looks at the restaurant (reviews with no reply,
-- the Google profile, what customers say, nearby rivals, the next 30 days, the
-- QR poster), drafts the work, and sends one WhatsApp message about it. Every
-- draft still goes through the checkers, the owner's approval and the release gate.
--
--   business_reviews        one per restaurant (unique), so it never runs twice;
--                           the builder's "Run again" (admin console) replaces it
--   business_review_parts   one row per piece of the review (its own job), so
--                           parts running side by side never overwrite each other
--   review_tags             themes and sentiment per review (Haiku), also read by
--                           the Monday report
--   rival_places            the nearby rivals' Google place ids, nothing else
--                           (Places terms: other details are fetched fresh)
--   calendar_events         UK and community dates, written only from code
--                           (src/lib/review/calendar.ts), never by AI
--   time_saved_log          estimated minutes per drafted or finished action,
--                           once per action (unique), so a retry never counts twice
--   restaurants.dummy_google_profile  the Google profile the dummy and simulated
--                           connector reads and changes (so fixes and UNDO are real)
--   restaurants.event_audiences       which community dates the owner said to plan
--                           for (muslim, hindu_sikh, chinese_east_asian, ...);
--                           null = not asked yet, so only dates for everyone
--   drafts.business_review_id         what the review drafted
--   drafts kind 'profile_fix'         a Google profile fix (empty fields only)
--
-- Only adds things, so the code before it keeps working. Safe to re-run.

create table if not exists business_reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references restaurants(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'sending', 'sent', 'waiting_window', 'failed', 'nothing')),
  started_by text not null default 'onboarding' check (started_by in ('onboarding', 'builder', 'test')),
  google_connected boolean,
  started_at timestamptz,
  deadline_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  sent_via text check (sent_via in ('session', 'template', 'waiting')),
  facts jsonb,
  message text,
  flow_step text,
  flow_state jsonb not null default '{}'::jsonb,
  flow_started_at timestamptz,
  flow_ended_at timestamptz,
  receipt_due_at timestamptz,
  receipt_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_review_parts (
  review_id uuid not null references business_reviews(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  part text not null,
  status text not null default 'queued' check (status in ('queued', 'done', 'failed', 'skipped')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (review_id, part)
);
create index if not exists business_review_parts_restaurant on business_review_parts (restaurant_id);

create table if not exists review_tags (
  review_id uuid primary key references reviews(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  themes jsonb not null default '[]'::jsonb,
  sentiment text check (sentiment in ('positive', 'mixed', 'negative')),
  model text,
  tagged_at timestamptz not null default now()
);
create index if not exists review_tags_restaurant on review_tags (restaurant_id);

create table if not exists rival_places (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  place_id text not null,
  rank int not null,
  found_at timestamptz not null default now(),
  primary key (restaurant_id, place_id)
);

create table if not exists calendar_events (
  key text primary key,
  name text not null,
  kind text not null,
  starts_on date not null,
  ends_on date,
  date_uncertain boolean not null default false,
  audience text not null default 'all',
  source text not null,
  notes text,
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_starts on calendar_events (starts_on);

create table if not exists time_saved_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  action text not null,
  ref text not null,
  minutes int not null check (minutes >= 0),
  status text not null default 'drafted' check (status in ('drafted', 'done')),
  logged_at timestamptz not null default now(),
  unique (restaurant_id, action, ref)
);

alter table restaurants add column if not exists dummy_google_profile jsonb;
alter table restaurants add column if not exists event_audiences text[];
alter table drafts add column if not exists business_review_id uuid references business_reviews(id) on delete set null;
create index if not exists drafts_business_review on drafts (business_review_id) where business_review_id is not null;

alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question',
                  'profile_change', 'agent_question', 'special_idea', 'choice', 'rota', 'profile_fix'));

-- Row-level security: the app uses the secret key; the read policy is for the owner pages' second wall.
alter table business_reviews enable row level security;
alter table business_review_parts enable row level security;
alter table review_tags enable row level security;
alter table rival_places enable row level security;
alter table calendar_events enable row level security;
alter table time_saved_log enable row level security;
drop policy if exists ops_read on business_reviews;
create policy ops_read on business_reviews for select to authenticated using (ops_owns_restaurant(restaurant_id));
drop policy if exists ops_read on business_review_parts;
create policy ops_read on business_review_parts for select to authenticated using (ops_owns_restaurant(restaurant_id));
drop policy if exists ops_read on review_tags;
create policy ops_read on review_tags for select to authenticated using (ops_owns_restaurant(restaurant_id));
drop policy if exists ops_read on rival_places;
create policy ops_read on rival_places for select to authenticated using (ops_owns_restaurant(restaurant_id));
drop policy if exists ops_read on time_saved_log;
create policy ops_read on time_saved_log for select to authenticated using (ops_owns_restaurant(restaurant_id));
drop policy if exists everyone_reads on calendar_events;
create policy everyone_reads on calendar_events for select to authenticated using (true);

insert into job_types (type, runner, max_running, max_attempts, lock_seconds, description) values
  ('business_review', 'app', 5, 3, 120, 'After onboarding: starts the business review (queues its parts and the 10-minute send)'),
  ('business_review_part', 'app', 6, 2, 280, 'One part of the business review (reviews, profile, themes, rivals, events, poster)'),
  ('business_review_send', 'app', 5, 3, 180, 'Sends the business review once its parts are done, or 10 minutes after it started'),
  ('review_reply_release', 'app', 2, 3, 120, 'One approved review reply through the release gate, paced a few seconds apart'),
  ('business_review_receipt', 'app', 3, 2, 120, 'The evening receipt after the business review: what went out, what is waiting, time saved')
on conflict (type) do nothing;

insert into schema_migrations (name) values ('058_business_review.sql') on conflict (name) do nothing;
