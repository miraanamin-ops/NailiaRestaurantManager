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

insert into schema_migrations (name) values ('021_visibility.sql') on conflict (name) do nothing;
