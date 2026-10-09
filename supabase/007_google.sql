-- =====================================================================
-- Naila step 7: Google reviews and posts (dummy mode)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data.
-- (The hourly schedule is set up separately; see the instructions.)
-- =====================================================================

-- Reviews: in dummy mode this table plays the part of Google.
alter table reviews add column if not exists reply_text      text;         -- the posted owner reply
alter table reviews add column if not exists reply_posted_at timestamptz;
alter table reviews add column if not exists handled_at      timestamptz;  -- when our review check picked it up
alter table reviews add column if not exists google_review_id text;
-- (reviews.source already exists from setup.sql, default 'google'. Reviews that
--  "appear on Google" in dummy mode via NEW REVIEW are marked 'dummy_google'.)

-- Reviews from before this step count as already seen, so the first check
-- doesn't draft replies to all of them.
update reviews set handled_at = created_at where handled_at is null and source = 'google';

-- Google posts: drafted here, "published" to Google (or to this table, in dummy mode).
create table if not exists google_posts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  draft_id        uuid unique references drafts(id) on delete cascade,
  topic           text not null check (topic in ('update', 'offer', 'event')),
  text            text not null,
  photo_url       text,
  published_at    timestamptz,
  google_post_id  text,
  created_at      timestamptz not null default now()
);
create index if not exists google_posts_restaurant_idx on google_posts (restaurant_id, published_at desc);
alter table google_posts enable row level security;

-- Drafts can now be Google posts.
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'birthday', 'promotion', 'other', 'email_campaign', 'google_post'));

-- Twice-weekly post drafting guard.
alter table restaurants add column if not exists last_post_draft_on date;

-- Public storage for photos sent on WhatsApp (shown on posts).
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do nothing;
