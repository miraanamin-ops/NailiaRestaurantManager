-- 069: rota roles and suggested staffing (owner's plan, 12 Nov 2026). Safe to re-run.
--
-- 1. rota_rules gain, per role:
--      driver               which orders make the role busier: all, eat_in, takeaway,
--                           delivery or none (empty = all orders, as every older rule)
--      before_open_minutes  starts this long before opening (prep, setting up)
--      after_close_minutes  stays this long after closing (washing up, locking up)
--      preset               where the numbers came from: 'seats:30_60', 'learned', 'owner'
-- 2. staff.can_open_close: can open up and lock up (a key holder). The rota puts
--    one on the first and last shift of each day once anyone is marked.
-- Roles themselves are text (staff.roles, rota_rules.role): the new ones (head_chef,
-- chef, kitchen_porter, server, host, bar, runner, counter, driver) need no change.
-- Past rotas read at setup are saved as rota weeks with source 'photo' or 'export'.

alter table rota_rules add column if not exists driver text;
alter table rota_rules add column if not exists before_open_minutes int not null default 0;
alter table rota_rules add column if not exists after_close_minutes int not null default 0;
alter table rota_rules add column if not exists preset text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rota_rules_driver_check') then
    alter table rota_rules add constraint rota_rules_driver_check check (driver is null or driver in ('all', 'eat_in', 'takeaway', 'delivery', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rota_rules_edges_check') then
    alter table rota_rules add constraint rota_rules_edges_check check (before_open_minutes between 0 and 180 and after_close_minutes between 0 and 180);
  end if;
end $$;

alter table staff add column if not exists can_open_close boolean not null default false;

insert into schema_migrations (name) values ('069_rota_roles.sql') on conflict (name) do nothing;
