-- =====================================================================
-- DinerAI operations data, part 8 of 8: only dishes change the menu
-- Run this only AFTER the new code is live (the code that saves menus through
-- save_menu). Paste it into Supabase > SQL Editor and click "Run".
-- Safe to run more than once.
--
-- 1. Any menu changed by the old code since 031 ran is copied into the dishes
--    (matched by name), so nothing an owner did in between is lost.
-- 2. From then on restaurants.menu can only be written by save_menu (and the
--    demo clear-out); anything else trying to change it gets an error, so the
--    menu can never be edited in two places.
-- =====================================================================

begin;

do $$
declare
  r record;
begin
  for r in select id, menu from restaurants order by created_at, id loop
    if r.menu is distinct from menu_json(r.id) then
      perform save_menu(r.id, r.menu, 'migrated', '[]'::jsonb, null);
    end if;
  end loop;
end $$;

-- Refuses a change to restaurants.menu unless save_menu is making it.
create or replace function ops_menu_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('ops.menu_write', true), '') = 'on' then return new; end if;
  if new.menu is not distinct from old.menu then return new; end if;
  raise exception 'restaurants.menu is made from the dishes: save the menu with save_menu() (src/lib/ops/menu.ts saveMenu)'
    using errcode = 'P0001';
end;
$$;

-- A new restaurant may arrive with a menu (the demo seeds do): it goes straight into dishes.
create or replace function ops_menu_after_insert() returns trigger
language plpgsql as $$
begin
  if new.menu is distinct from '[]'::jsonb and not exists (select 1 from menu_sections where restaurant_id = new.id) then
    perform save_menu(new.id, new.menu, 'manual', '[]'::jsonb, null);
  end if;
  return null;
end;
$$;

drop trigger if exists ops_menu_guard on restaurants;
create trigger ops_menu_guard before update of menu on restaurants
  for each row execute function ops_menu_guard();
drop trigger if exists ops_menu_after_insert on restaurants;
create trigger ops_menu_after_insert after insert on restaurants
  for each row execute function ops_menu_after_insert();

insert into schema_migrations (name) values ('037_ops_menu_guard.sql') on conflict (name) do nothing;

commit;
