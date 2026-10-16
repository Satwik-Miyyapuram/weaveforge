-- Opaque, short-lived device approval envelopes. The server cannot decrypt them.

create table if not exists user_device_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requester_device_id text not null,
  requester_public_key bytea not null,
  response_envelope bytea,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint user_device_transfer_requests_expiry check (expires_at > created_at)
);

alter table user_device_transfer_requests enable row level security;

drop policy if exists "user_device_transfer_requests_owner" on user_device_transfer_requests;
create policy "user_device_transfer_requests_owner" on user_device_transfer_requests
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists user_device_transfer_requests_pending_idx
  on user_device_transfer_requests (user_id, created_at)
  where status = 'pending';
