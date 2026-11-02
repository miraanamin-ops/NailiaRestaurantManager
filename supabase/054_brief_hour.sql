-- 054: the hour the owner's morning brief arrives (Dina's step 12, Approvals and
-- timing). Whole hours, 7am to 11am UK time (decision 8, 28 Oct); 9am unless the
-- owner picks another. The hourly job starts a restaurant's morning job from this
-- hour (src/lib/morning-gate.ts), and the late-brief alert waits until half an
-- hour after it (src/lib/job-health.ts).
-- Safe to re-run.

alter table restaurants add column if not exists brief_hour int not null default 9;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_brief_hour_range') then
    alter table restaurants add constraint restaurants_brief_hour_range check (brief_hour between 7 and 11);
  end if;
end $$;

insert into schema_migrations (name) values ('054_brief_hour.sql') on conflict (name) do nothing;
