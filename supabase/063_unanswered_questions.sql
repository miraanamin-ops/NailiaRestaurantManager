-- 063: owner messages the assistant couldn't answer (Part 3 of the help/advice work, 9 Nov 2026).
-- Every off-topic message, blocked reply, question the help guide doesn't cover, or
-- message nothing could handle is logged here, so the builder can see what owners ask
-- that DinerAI can't do yet (admin console). Safe to re-run.

create table if not exists unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Who sent it: the owner's WhatsApp number.
  sender text,
  message text not null,
  -- Where the GM sent it (how_to, chat, advice, off_topic...), or null if it couldn't route it.
  route text,
  -- off_topic | not_in_guide | blocked | could_not_help | router_failed
  reason text not null check (reason in ('off_topic', 'not_in_guide', 'blocked', 'could_not_help', 'router_failed')),
  -- What was wrong (the checker's notes, or the error), for the builder.
  detail text,
  -- The question was emailed to support (not_in_guide).
  emailed_support_at timestamptz
);
create index if not exists unanswered_questions_recent on unanswered_questions (created_at desc);
create index if not exists unanswered_questions_restaurant on unanswered_questions (restaurant_id, created_at desc);

alter table unanswered_questions enable row level security;

insert into schema_migrations (name) values ('063_unanswered_questions.sql') on conflict (name) do nothing;
