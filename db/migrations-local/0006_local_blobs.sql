-- Attachments, for a copy of the app that has no storage service.
--
-- Supabase Storage is a service, not a table, so the local database has no
-- equivalent to migrate: without this, a PDF or a pasted image is the one
-- thing an account-less copy cannot keep. The bytes live here as base64
-- because the bridge to the shell carries text, and the row is scoped to the
-- local user for the same reason every other local table is.
create table if not exists public.local_blobs (
  bucket text not null,
  path text not null,
  content_type text not null default 'application/octet-stream',
  bytes text not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, path)
);
