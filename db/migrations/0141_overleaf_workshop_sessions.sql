-- Overleaf Workshop sign-in sessions. The Overleaf cookie is sealed by the
-- server (AES-256-GCM, OVERLEAF_CREDENTIAL_KEY) before it is stored, and it is
-- never returned to the browser. Clients hold only the row id.

create table if not exists overleaf_workshop_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  cookie_ciphertext  text not null,
  created_at         timestamptz not null default now()
);

create index if not exists overleaf_workshop_sessions_user_idx
  on overleaf_workshop_sessions (user_id, created_at desc);

alter table overleaf_workshop_sessions enable row level security;

-- RLS only filters rows; the role also needs table privileges to use them.
grant select, insert, delete on overleaf_workshop_sessions to authenticated;

drop policy if exists "overleaf_workshop_sessions_own" on overleaf_workshop_sessions;
create policy "overleaf_workshop_sessions_own" on overleaf_workshop_sessions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
