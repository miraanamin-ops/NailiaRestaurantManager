-- =====================================================================
-- DinerAI: logged in straight after sign-up (onboarding with Dina, phase 2).
-- Paste this into Supabase > SQL Editor and click "Run".
-- Safe to run more than once; it keeps your existing data. Safe for the
-- live site before the new code is deployed (it only adds things).
--
--   1. signup_sessions: a brand-new owner is logged in as soon as they sign up
--      (the same Supabase login as a login link, made without the email). Those
--      logins are listed here by their session id, and such a login can only
--      ever see the one restaurant it signed up (lib/auth.ts): someone who signs
--      up with another person's email never sees that person's restaurants. A
--      login from an emailed link is a different session and works as usual.
--      Only the app's server reads it (Row Level Security on, no policies).
--   2. Finding a sign-up by the WhatsApp number typed on the form, for linking
--      it when that number first messages us.
-- =====================================================================

create table if not exists signup_sessions (
  session_id     uuid primary key,
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  created_at     timestamptz not null default now()
);
alter table signup_sessions enable row level security;

create index if not exists onboarding_pending_whatsapp_idx on onboarding (pending_whatsapp) where pending_whatsapp is not null;

insert into schema_migrations (name) values ('049_signup_sessions.sql') on conflict (name) do nothing;
