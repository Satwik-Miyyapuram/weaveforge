-- Integration credentials, for a copy of the app that has no server.
--
-- On a server these are held behind `/api/settings/credentials` so the browser
-- never keeps them. A copy with no account has no server and no other user to
-- keep them from: they live beside the rest of the local data, under the same
-- file permissions, and the app is explicit about that in Settings.
create table if not exists public.local_secrets (
  user_id uuid primary key,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
