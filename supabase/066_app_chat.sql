-- 066: the app's Chat tab (step 50, phase 3). Safe to re-run.
--
-- 1. messages.app: what an app message carries besides its words: the quick-reply
--    buttons the bot offered, the draft it shows as a card, a picture, or the file
--    the owner sent. App messages are logged in this same table (to or from "app"),
--    so WhatsApp and the app share one conversation.
-- 2. An index for loading one restaurant's conversation, newest first.
-- 3. A private bucket for photos and files sent in the app (16 MB a file). Files live at
--    <restaurant id>/<date>/<id>.<ext>; the app reads them only through short signed links.

alter table messages add column if not exists app jsonb;

create index if not exists messages_restaurant_idx on messages (restaurant_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-uploads',
  'app-uploads',
  false,
  16777216,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into schema_migrations (name) values ('066_app_chat.sql') on conflict (name) do nothing;
