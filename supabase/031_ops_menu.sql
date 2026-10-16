-- =====================================================================
-- DinerAI operations data, part 2 of 8: the menu, recipes and till items
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things, and
-- restaurants.menu reads exactly as before).
--
-- The menu moves into dishes. restaurants.menu stays, but only as a copy that
-- save_menu() makes from the dishes (037 stops anything else changing it).
-- This file copies every restaurant's menu into dishes, then checks the menu
-- made from the dishes is the same as before for every restaurant; if one
-- differs it stops and nothing is saved. The old menus are kept in
-- menu_json_backup. To undo: supabase/rollback/ops_rollback.sql.
-- =====================================================================

begin;

-- 1. Menu sections (the menu's "category"), in order.
--    json_keys and extra exist only so the menu made from these rows is exactly
--    the old menu (a key that was missing stays missing, unknown keys survive).
create table if not exists menu_sections (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  name           text not null,
  position       int  not null,
  json_keys      text[] not null default '{category,items}',
  extra          jsonb not null default '{}'::jsonb,
  active_from    date not null default london_day(now()),
  active_to      date,                                  -- not on the menu from this day (empty = on the menu now)
  source         ops_source not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, restaurant_id),
  check (active_to is null or active_to >= active_from)
);
create index if not exists menu_sections_restaurant_idx on menu_sections (restaurant_id) where active_to is null;

-- 2. Dishes: the single source of truth for the menu. A dish keeps its id when it's
--    renamed, re-priced, moved or taken off and put back, so its price history,
--    recipe and till matches stay with it.
create table if not exists dishes (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  section_id           uuid not null,
  name                 text not null,
  description          text,
  allergens            text[] not null default '{}',
  allergens_confirmed  boolean not null default false,  -- customers only ever see confirmed allergens
  position             int  not null,
  json_keys            text[] not null default '{name,price,description,allergens,allergens_confirmed}',
  extra                jsonb not null default '{}'::jsonb,
  active_from          date not null default london_day(now()),
  active_to            date,                            -- off the menu from this day (empty = on the menu now)
  source               ops_source not null default 'manual',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (section_id, restaurant_id) references menu_sections (id, restaurant_id) on delete cascade,
  check (active_to is null or active_to >= active_from)
);
create index if not exists dishes_restaurant_idx on dishes (restaurant_id, section_id, position) where active_to is null;
create index if not exists dishes_name_idx on dishes (restaurant_id, ops_name_key(name));

-- 3. Dish prices over time. Never changed: a new price is a new row. The price on
--    a day is the row with the latest effective_from on or before it (ties: the
--    latest recorded_at). Empty price = the menu gave none.
create table if not exists dish_prices (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  dish_id         uuid not null,
  price_pence     int check (price_pence is null or price_pence >= 0),
  effective_from  date not null,
  recorded_at     timestamptz not null default now(),
  source          ops_source not null default 'manual',
  created_at      timestamptz not null default now(),
  foreign key (dish_id, restaurant_id) references dishes (id, restaurant_id) on delete cascade
);
create index if not exists dish_prices_dish_idx on dish_prices (dish_id, effective_from desc, recorded_at desc);
create index if not exists dish_prices_restaurant_idx on dish_prices (restaurant_id, effective_from);

-- 4. Every name change of a dish (settings, a rename message, or UNDO of one).
create table if not exists dish_renames (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  dish_id        uuid not null,
  old_name       text not null,
  new_name       text not null,
  renamed_at     timestamptz not null default now(),
  source         ops_source not null default 'manual',
  foreign key (dish_id, restaurant_id) references dishes (id, restaurant_id) on delete cascade
);
create index if not exists dish_renames_dish_idx on dish_renames (restaurant_id, dish_id, renamed_at desc);

-- 5. Ingredients, each in one standard unit: grams, millilitres or each.
create table if not exists ingredients (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  name           text not null,
  unit           text not null check (unit in ('g', 'ml', 'each')),
  category       text,                                   -- "meat", "dairy", "dry goods"...
  active         boolean not null default true,
  source         ops_source not null default 'manual',
  confirmed_at   timestamptz,
  confirmed_by   text,
  created_at     timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index if not exists ingredients_name_idx on ingredients (restaurant_id, ops_name_key(name));

-- 6. Recipes: a version per dish from a date (history pattern), and its lines.
create table if not exists recipe_versions (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  dish_id         uuid not null,
  effective_from  date not null,
  recorded_at     timestamptz not null default now(),
  portions        numeric(8, 2) not null default 1 check (portions > 0),  -- the lines make this many portions
  notes           text,
  source          ops_source not null default 'manual',
  confirmed_at    timestamptz,
  confirmed_by    text,
  created_at      timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (dish_id, restaurant_id) references dishes (id, restaurant_id) on delete cascade
);
create index if not exists recipe_versions_dish_idx on recipe_versions (dish_id, effective_from desc, recorded_at desc);

create table if not exists recipe_lines (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  recipe_version_id  uuid not null,
  ingredient_id      uuid not null,
  quantity           numeric(12, 3) not null check (quantity > 0),       -- in the ingredient's unit
  waste_pct          numeric(5, 2) not null default 0 check (waste_pct >= 0 and waste_pct < 100),  -- trimmed or lost in prep
  position           int not null default 0,
  created_at         timestamptz not null default now(),
  foreign key (recipe_version_id, restaurant_id) references recipe_versions (id, restaurant_id) on delete cascade,
  foreign key (ingredient_id, restaurant_id) references ingredients (id, restaurant_id)
);
create index if not exists recipe_lines_version_idx on recipe_lines (recipe_version_id);

-- 7. Till item names to dishes ("Chkn Tikka" = "Chicken Tikka"). One row per name
--    the till uses. dish_id empty and is_dish false = not a dish ("Service charge").
create table if not exists till_item_matches (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  till_name      text not null,
  till_key       text generated always as (ops_name_key(till_name)) stored,
  dish_id        uuid,
  is_dish        boolean not null default true,
  confidence     numeric(4, 3) check (confidence between 0 and 1),
  method         text not null check (method in ('exact', 'fuzzy', 'ai', 'owner')),
  source         ops_source not null default 'model',
  confirmed_at   timestamptz,                            -- the owner said it's right
  confirmed_by   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, till_key),
  foreign key (dish_id, restaurant_id) references dishes (id, restaurant_id),
  check (is_dish or dish_id is null)
);
-- Item sales are joined to their match by the same name key.
create index if not exists sales_items_key_idx on sales_items (restaurant_id, ops_name_key(item));

-- 8. The menus as they were before the move (one row per restaurant, never overwritten).
create table if not exists menu_json_backup (
  restaurant_id  uuid primary key references restaurants(id) on delete cascade,
  menu           jsonb not null,
  saved_at       timestamptz not null default now()
);

-- 9. A dish as one menu item (the shape restaurants.menu has always had).
create or replace function ops_dish_json(p_dish dishes, p_with_ids boolean default false) returns jsonb
language sql stable set search_path = public as $$
  select p_dish.extra
    || case when 'name' = any(p_dish.json_keys) then jsonb_build_object('name', p_dish.name) else '{}'::jsonb end
    || case when 'price' = any(p_dish.json_keys) then jsonb_build_object('price', (
         select case when p.price_pence is null then 'null'::jsonb else to_jsonb(trim_scale(p.price_pence::numeric / 100)) end
           from dish_prices p
          where p.dish_id = p_dish.id
          order by p.effective_from desc, p.recorded_at desc, p.created_at desc
          limit 1)) else '{}'::jsonb end
    || case when 'description' = any(p_dish.json_keys) then jsonb_build_object('description', p_dish.description) else '{}'::jsonb end
    || case when 'allergens' = any(p_dish.json_keys) then jsonb_build_object('allergens', to_jsonb(p_dish.allergens)) else '{}'::jsonb end
    || case when 'allergens_confirmed' = any(p_dish.json_keys) then jsonb_build_object('allergens_confirmed', p_dish.allergens_confirmed) else '{}'::jsonb end
    || case when p_with_ids then jsonb_build_object('id', p_dish.id) else '{}'::jsonb end
$$;

-- The whole menu, made from the dishes on it now. p_with_ids adds each section's
-- and dish's id (for the settings page, so an edit keeps the same dish).
create or replace function menu_json(p_restaurant_id uuid, p_with_ids boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(s.obj order by s.position, s.created_at, s.id), '[]'::jsonb)
    from (
      select ms.position, ms.created_at, ms.id,
             ms.extra
             || case when 'category' = any(ms.json_keys) then jsonb_build_object('category', ms.name) else '{}'::jsonb end
             || case when 'items' = any(ms.json_keys) then jsonb_build_object('items', coalesce((
                  select jsonb_agg(ops_dish_json(d, p_with_ids) order by d.position, d.created_at, d.id)
                    from dishes d
                   where d.restaurant_id = p_restaurant_id and d.section_id = ms.id and d.active_to is null), '[]'::jsonb))
                else '{}'::jsonb end
             || case when p_with_ids then jsonb_build_object('id', ms.id) else '{}'::jsonb end as obj
        from menu_sections ms
       where ms.restaurant_id = p_restaurant_id and ms.active_to is null
    ) s
$$;

-- The price of a dish on a day, as known at a moment (p_known_at empty = now):
-- the latest effective_from on or before the day, ignoring rows recorded later.
create or replace function dish_price_on(p_dish_id uuid, p_day date, p_known_at timestamptz default null) returns int
language sql stable set search_path = public as $$
  select price_pence from dish_prices
   where dish_id = p_dish_id and effective_from <= p_day and recorded_at <= coalesce(p_known_at, 'infinity'::timestamptz)
   order by effective_from desc, recorded_at desc, created_at desc
   limit 1
$$;

-- 10. Saving a menu: the one way the menu changes. p_menu is the menu as the app
--     has always held it ([{category, items: [{name, price, ...}]}]); a section or
--     item may carry "id" (from the settings page) to say which row it is.
--     p_renames: [{"from": "old name", "to": "new name"}] from a rename message.
--     How each item finds its dish, in order:
--       1. its id (settings)            2. an explicit rename
--       3. a dish with the same name on the menu now (same section first)
--       4. a dish on the menu that used to have this name (UNDO of a rename)
--       5. a dish with this name taken off before (put back: same dish again)
--       6. otherwise a new dish.
--     Dishes no longer on the menu get active_to = today. A changed price is a
--     new dish_prices row. A changed name is a dish_renames row. Then the menu
--     copy in restaurants.menu is made again from the dishes. Returns that copy.
create or replace function save_menu(p_restaurant_id uuid, p_menu jsonb, p_source text default 'manual',
                                     p_renames jsonb default '[]'::jsonb, p_today date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today    date := coalesce(p_today, london_day(now()));
  v_sec      jsonb;
  v_sec_pos  int;
  v_item     jsonb;
  v_item_pos int;
  v_sec_id   uuid;
  v_name     text;
  v_keys     text[];
  v_extra    jsonb;
  v_claimed_sections uuid[] := '{}';
  r          record;
  v_dish     uuid;
  v_dish_row dishes;
  v_price    int;
  v_has_price boolean;
  v_cur_price int;
  v_found    boolean;
  v_json     jsonb;
begin
  if jsonb_typeof(p_menu) is distinct from 'array' then
    raise exception 'save_menu: the menu must be a list of sections';
  end if;
  perform 1 from restaurants where id = p_restaurant_id for update;
  if not found then raise exception 'save_menu: no restaurant %', p_restaurant_id; end if;

  create temp table if not exists _menu_in (
    sec_pos int, item_pos int, section_id uuid, item jsonb, name text, key text, dish_id uuid, how text
  ) on commit drop;
  truncate _menu_in;

  -- Sections, in order: by id, then the same name on the menu now, then one taken
  -- off before, then a new one.
  for v_sec, v_sec_pos in select value, ordinality from jsonb_array_elements(p_menu) with ordinality loop
    if jsonb_typeof(v_sec) is distinct from 'object' then raise exception 'save_menu: section % is not an object', v_sec_pos; end if;
    if v_sec ? 'items' and jsonb_typeof(v_sec -> 'items') is distinct from 'array' then raise exception 'save_menu: section % items is not a list', v_sec_pos; end if;
    v_extra := v_sec - 'id' - 'items';
    v_keys := '{}';
    v_name := '';
    if jsonb_typeof(v_sec -> 'category') = 'string' then
      v_name := v_sec ->> 'category';
      v_keys := v_keys || 'category'::text;
      v_extra := v_extra - 'category';
    end if;
    if v_sec ? 'items' then v_keys := v_keys || 'items'::text; end if;

    v_sec_id := null;
    if v_sec ? 'id' then
      select id into v_sec_id from menu_sections
       where restaurant_id = p_restaurant_id and id::text = v_sec ->> 'id' and not (id = any(v_claimed_sections));
    end if;
    if v_sec_id is null then
      select id into v_sec_id from menu_sections
       where restaurant_id = p_restaurant_id and active_to is null and ops_name_key(name) = ops_name_key(v_name)
         and not (id = any(v_claimed_sections))
       order by position, created_at limit 1;
    end if;
    if v_sec_id is null then
      select id into v_sec_id from menu_sections
       where restaurant_id = p_restaurant_id and active_to is not null and ops_name_key(name) = ops_name_key(v_name)
         and not (id = any(v_claimed_sections))
       order by active_to desc, created_at desc limit 1;
    end if;
    if v_sec_id is null then
      insert into menu_sections (restaurant_id, name, position, json_keys, extra, active_from, source)
      values (p_restaurant_id, v_name, v_sec_pos, v_keys, v_extra, v_today, p_source)
      returning id into v_sec_id;
    else
      update menu_sections
         set name = v_name, position = v_sec_pos, json_keys = v_keys, extra = v_extra, active_to = null, updated_at = now()
       where id = v_sec_id
         and (name, position, json_keys, extra, active_to) is distinct from (v_name, v_sec_pos, v_keys, v_extra, null::date);
    end if;
    v_claimed_sections := v_claimed_sections || v_sec_id;

    for v_item, v_item_pos in select value, ordinality from jsonb_array_elements(coalesce(v_sec -> 'items', '[]'::jsonb)) with ordinality loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'save_menu: item % in section % is not an object', v_item_pos, v_sec_pos; end if;
      insert into _menu_in (sec_pos, item_pos, section_id, item, name, key)
      values (v_sec_pos, v_item_pos, v_sec_id, v_item,
              case when jsonb_typeof(v_item -> 'name') = 'string' then v_item ->> 'name' else coalesce(v_item ->> 'name', '') end,
              ops_name_key(coalesce(v_item ->> 'name', '')));
    end loop;
  end loop;

  -- 1. By id (the first item naming an id gets it).
  update _menu_in m set dish_id = d.id, how = 'id'
    from dishes d
   where d.restaurant_id = p_restaurant_id and m.item ? 'id' and d.id::text = m.item ->> 'id'
     and (m.sec_pos, m.item_pos) = (
       select m2.sec_pos, m2.item_pos from _menu_in m2 where m2.item ->> 'id' = m.item ->> 'id' order by m2.sec_pos, m2.item_pos limit 1);

  -- 2. Explicit renames: the item with the new name takes the dish with the old name.
  for r in select value ->> 'from' as old_name, value ->> 'to' as new_name from jsonb_array_elements(coalesce(p_renames, '[]'::jsonb)) loop
    select d.id into v_dish from dishes d
     where d.restaurant_id = p_restaurant_id and d.active_to is null and ops_name_key(d.name) = ops_name_key(r.old_name)
       and not exists (select 1 from _menu_in c where c.dish_id = d.id)
     order by d.position, d.created_at limit 1;
    if v_dish is not null then
      update _menu_in m set dish_id = v_dish, how = 'rename'
       where (m.sec_pos, m.item_pos) = (
         select sec_pos, item_pos from _menu_in where dish_id is null and key = ops_name_key(r.new_name) order by sec_pos, item_pos limit 1);
    end if;
  end loop;

  -- 3 to 6, item by item in menu order.
  for r in select * from _menu_in where dish_id is null order by sec_pos, item_pos loop
    v_dish := null;
    -- 3. Same name on the menu now (same section first).
    select d.id into v_dish from dishes d
     where d.restaurant_id = p_restaurant_id and d.active_to is null and ops_name_key(d.name) = r.key
       and not exists (select 1 from _menu_in c where c.dish_id = d.id)
     order by (d.section_id = r.section_id) desc, d.position, d.created_at limit 1;
    -- 4. A dish on the menu that used to have this name.
    if v_dish is null then
      select d.id into v_dish from dishes d join dish_renames n on n.dish_id = d.id and n.restaurant_id = d.restaurant_id
       where d.restaurant_id = p_restaurant_id and d.active_to is null and ops_name_key(n.old_name) = r.key
         and not exists (select 1 from _menu_in c where c.dish_id = d.id)
         and not exists (select 1 from _menu_in c where c.dish_id is null and c.key = ops_name_key(d.name))  -- its own name isn't still wanted
       order by n.renamed_at desc limit 1;
    end if;
    -- 5. Taken off before, now put back.
    if v_dish is null then
      select d.id into v_dish from dishes d
       where d.restaurant_id = p_restaurant_id and d.active_to is not null and ops_name_key(d.name) = r.key
         and not exists (select 1 from _menu_in c where c.dish_id = d.id)
       order by d.active_to desc, d.created_at desc limit 1;
    end if;
    update _menu_in set dish_id = v_dish, how = case when v_dish is null then null else 'name' end
     where sec_pos = r.sec_pos and item_pos = r.item_pos;
  end loop;

  -- Write each dish.
  for r in select * from _menu_in order by sec_pos, item_pos loop
    v_extra := r.item - 'id';
    v_keys := '{}';
    if jsonb_typeof(r.item -> 'name') = 'string' then v_keys := v_keys || 'name'::text; v_extra := v_extra - 'name'; end if;
    v_has_price := false;
    v_price := null;
    if r.item ? 'price' and jsonb_typeof(r.item -> 'price') = 'null' then
      v_has_price := true; v_keys := v_keys || 'price'::text; v_extra := v_extra - 'price';
    elsif jsonb_typeof(r.item -> 'price') = 'number' and (r.item ->> 'price')::numeric >= 0
          and (r.item ->> 'price')::numeric * 100 = round((r.item ->> 'price')::numeric * 100)
          and (r.item ->> 'price')::numeric < 20000000 then
      v_has_price := true; v_price := ((r.item ->> 'price')::numeric * 100)::int;
      v_keys := v_keys || 'price'::text; v_extra := v_extra - 'price';
    end if;
    if r.item ? 'description' and jsonb_typeof(r.item -> 'description') in ('string', 'null') then
      v_keys := v_keys || 'description'::text; v_extra := v_extra - 'description';
    end if;
    if jsonb_typeof(r.item -> 'allergens') = 'array'
       and not exists (select 1 from jsonb_array_elements(r.item -> 'allergens') a where jsonb_typeof(a) <> 'string') then
      v_keys := v_keys || 'allergens'::text; v_extra := v_extra - 'allergens';
    end if;
    if jsonb_typeof(r.item -> 'allergens_confirmed') = 'boolean' then
      v_keys := v_keys || 'allergens_confirmed'::text; v_extra := v_extra - 'allergens_confirmed';
    end if;

    if r.dish_id is null then
      insert into dishes (restaurant_id, section_id, name, description, allergens, allergens_confirmed, position, json_keys, extra, active_from, source)
      values (p_restaurant_id, r.section_id, r.name,
              case when 'description' = any(v_keys) then r.item ->> 'description' end,
              case when 'allergens' = any(v_keys) then array(select jsonb_array_elements_text(r.item -> 'allergens')) else '{}'::text[] end,
              case when 'allergens_confirmed' = any(v_keys) then (r.item ->> 'allergens_confirmed')::boolean else false end,
              r.item_pos, v_keys, v_extra, v_today, p_source)
      returning id into v_dish;
    else
      v_dish := r.dish_id;
      select * into v_dish_row from dishes where id = v_dish;
      if v_dish_row.name is distinct from r.name then
        insert into dish_renames (restaurant_id, dish_id, old_name, new_name, source)
        values (p_restaurant_id, v_dish, v_dish_row.name, r.name, p_source);
      end if;
      update dishes
         set section_id = r.section_id,
             name = r.name,
             description = case when 'description' = any(v_keys) then r.item ->> 'description' else description end,
             allergens = case when 'allergens' = any(v_keys) then array(select jsonb_array_elements_text(r.item -> 'allergens')) else allergens end,
             allergens_confirmed = case when 'allergens_confirmed' = any(v_keys) then (r.item ->> 'allergens_confirmed')::boolean else allergens_confirmed end,
             position = r.item_pos,
             json_keys = v_keys,
             extra = v_extra,
             active_to = null,
             updated_at = now()
       where id = v_dish;
    end if;

    -- A new price row only when the price changed (or the dish has none yet).
    select price_pence into v_cur_price from dish_prices
     where dish_id = v_dish order by effective_from desc, recorded_at desc, created_at desc limit 1;
    v_found := found;
    if not v_found or v_cur_price is distinct from v_price then
      if v_has_price or v_found then
        insert into dish_prices (restaurant_id, dish_id, price_pence, effective_from, source)
        values (p_restaurant_id, v_dish, v_price, v_today, p_source);
      end if;
    end if;
    update _menu_in set dish_id = v_dish where sec_pos = r.sec_pos and item_pos = r.item_pos;
  end loop;

  -- Off the menu: dishes and sections nobody claimed.
  update dishes d set active_to = greatest(v_today, d.active_from), updated_at = now()
   where d.restaurant_id = p_restaurant_id and d.active_to is null
     and not exists (select 1 from _menu_in c where c.dish_id = d.id);
  update menu_sections s set active_to = greatest(v_today, s.active_from), updated_at = now()
   where s.restaurant_id = p_restaurant_id and s.active_to is null and not (s.id = any(v_claimed_sections));

  -- The menu copy, made from the dishes (the only write to restaurants.menu; 037's guard lets it through).
  v_json := menu_json(p_restaurant_id);
  perform set_config('ops.menu_write', 'on', true);
  update restaurants set menu = v_json where id = p_restaurant_id and menu is distinct from v_json;
  perform set_config('ops.menu_write', 'off', true);
  return v_json;
end;
$$;

-- Only the app's server (secret key) may call these.
revoke all on function save_menu(uuid, jsonb, text, jsonb, date) from public;
revoke all on function menu_json(uuid, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function save_menu(uuid, jsonb, text, jsonb, date) from anon, authenticated;
    revoke all on function menu_json(uuid, boolean) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function save_menu(uuid, jsonb, text, jsonb, date) to service_role;
    grant execute on function menu_json(uuid, boolean) to service_role;
  end if;
end $$;

-- 11. RLS (030): owners read and change their menu; prices and renames are history.
select ops_apply_policies('menu_sections', 'owned');
select ops_apply_policies('dishes', 'owned');
select ops_apply_policies('dish_prices', 'append');
select ops_apply_policies('dish_renames', 'append');
select ops_apply_policies('ingredients', 'owned');
select ops_apply_policies('recipe_versions', 'append');
select ops_apply_policies('recipe_lines', 'append');
select ops_apply_policies('till_item_matches', 'owned');
alter table menu_json_backup enable row level security;

-- 12. Move every restaurant's menu into dishes (only restaurants not moved yet),
--     then check the menu made from the dishes equals the old one. Equal means the
--     same JSON value: 7.50 and 7.5 are the same number. If any differ, stop.
insert into menu_json_backup (restaurant_id, menu)
select id, menu from restaurants
on conflict (restaurant_id) do nothing;

do $$
declare
  r record;
  v_after jsonb;
  v_bad text[] := '{}';
begin
  for r in select id, name, menu from restaurants
            where not exists (select 1 from menu_sections s where s.restaurant_id = restaurants.id)
            order by created_at, id loop
    v_after := save_menu(r.id, r.menu, 'migrated', '[]'::jsonb, null);
    if v_after is distinct from r.menu then v_bad := v_bad || (r.name || ' (' || r.id || ')'); end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'Menu move stopped, nothing was saved: the menu made from dishes differs for %', array_to_string(v_bad, ', ');
  end if;
end $$;

insert into schema_migrations (name) values ('031_ops_menu.sql') on conflict (name) do nothing;

commit;
