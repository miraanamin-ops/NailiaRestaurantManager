-- Rolls back 069_rota_roles.sql. Run only after the code that uses these columns is gone.
alter table rota_rules drop constraint if exists rota_rules_driver_check;
alter table rota_rules drop constraint if exists rota_rules_edges_check;
alter table rota_rules drop column if exists driver;
alter table rota_rules drop column if exists before_open_minutes;
alter table rota_rules drop column if exists after_close_minutes;
alter table rota_rules drop column if exists preset;
alter table staff drop column if exists can_open_close;
delete from schema_migrations where name = '069_rota_roles.sql';
