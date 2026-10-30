-- 051: a private bucket for files owners send while setting up with Dina
-- (menu photos, PDFs, CSV and Excel exports), from WhatsApp now and the web chat later.
-- Private: no public links. The app reads it with the secret key; nobody else can.
-- Files live at <restaurant id>/<step>/<message id>-<n>.<ext>.
-- The limits match the code (src/lib/onboarding/dina/uploads.ts): 16 MB a file,
-- and only these types (code checks the file's first bytes too, not just its label).
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onboarding-uploads',
  'onboarding-uploads',
  false,
  16777216,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into schema_migrations (name) values ('051_onboarding_uploads.sql') on conflict (name) do nothing;
