-- Independent encrypted UMK wraps let one user remember multiple devices.

create table if not exists user_device_key_wraps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_label text not null default 'Browser device',
  kdf_params jsonb not null,
  wrapped_umk bytea not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, device_id)
);

alter table user_device_key_wraps enable row level security;

drop policy if exists "user_device_key_wraps_owner" on user_device_key_wraps;
create policy "user_device_key_wraps_owner" on user_device_key_wraps
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists user_device_key_wraps_active_idx
  on user_device_key_wraps (user_id, created_at)
  where revoked_at is null;
