-- =====================================================================
-- DinerAI agent organisation, phase 3a: the Visibility agent (and costs)
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
-- =====================================================================

-- 1. Special hours: { "2026-12-25": { "label": "Christmas Day", "hours": "Closed" } }.
--    "usual" means the owner said the normal hours apply that day.
alter table restaurants add column if not exists special_hours jsonb not null default '{}'::jsonb;

-- 2. The photo library: [{ id, url, source, caption, added_at }]. Starts with the
--    photos copied from Google at onboarding; photos the owner or staff send are added.
alter table restaurants add column if not exists photo_library jsonb not null default '[]'::jsonb;
update restaurants r
set photo_library = (
  select coalesce(jsonb_agg(jsonb_build_object('id', 'ph_g' || ord, 'url', url, 'source', 'google', 'caption', null, 'added_at', now())), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(r.photos, '[]'::jsonb)) with ordinality as p(url, ord)
)
where r.photo_library = '[]'::jsonb and jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) > 0;

-- 3. What each agent job used: tokens per agent, and the estimated cost in US dollars
--    (the API's own prices). Builder controls show it per restaurant per month.
alter table agent_jobs add column if not exists usage    jsonb;          -- { "reputation": { input, output, cacheRead, cacheWrite, cost }, "checker": {...} }
alter table agent_jobs add column if not exists cost_usd numeric(10, 6);
create index if not exists agent_jobs_cost_idx on agent_jobs (restaurant_id, created_at);

-- 4. Shadow drafts for any agent: what the job was about (a review, a photo, a
--    profile change...) and which task it was (e.g. google_post, photo).
alter table shadow_drafts alter column review drop not null;
alter table shadow_drafts add column if not exists task    text;
alter table shadow_drafts add column if not exists subject jsonb;   -- e.g. { "slot": "Monday" }, { "photo_url": ..., "sender": "staff" }

-- 5. Three new kinds of draft: the Google update that matches a change to the
--    opening hours (or special hours) or the menu (they always need Approve), and
--    a question about a bank holiday coming up (Same hours / Closed / Different hours).
alter table drafts drop constraint if exists drafts_kind_check;
alter table drafts add constraint drafts_kind_check
  check (kind in ('review_reply', 'promotion', 'other', 'email_campaign', 'google_post', 'review_question', 'hours_update', 'menu_update', 'hours_question'));

-- 6. Data we fetch from elsewhere and keep for a while (the UK bank holidays from gov.uk).
create table if not exists cached_data (
  key        text primary key,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table cached_data enable row level security;

insert into schema_migrations (name) values ('021_visibility.sql') on conflict (name) do nothing;
