-- Migration: blob registry for hot (R2) / cold (OCI) tiering.
-- Owned by the storage layer. See docs/storage/tiering.md.

create table if not exists blob_objects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) default auth.uid(),
  bucket           text not null,
  path             text not null,
  tier             text not null default 'hot' check (tier in ('hot', 'cold')),
  size_bytes       bigint not null default 0 check (size_bytes >= 0),
  access_count     int not null default 0 check (access_count >= 0),
  last_accessed_at timestamptz,
  priority         int not null default 50 check (priority >= 0 and priority <= 100),
  created_at       timestamptz not null default now(),
  unique (bucket, path)
);

create index if not exists blob_objects_hot_tier_idx on blob_objects (tier) where tier = 'hot';
create index if not exists blob_objects_user_idx on blob_objects (user_id);

alter table blob_objects enable row level security;

drop policy if exists "blob_objects_select_own" on blob_objects;
create policy "blob_objects_select_own" on blob_objects
  for select using (auth.uid() = user_id);

drop policy if exists "blob_objects_modify_own" on blob_objects;
create policy "blob_objects_modify_own" on blob_objects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
