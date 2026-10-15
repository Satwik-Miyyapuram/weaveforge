-- Per-resource DEKs + share wraps (plan §6 migration 0039).

create table if not exists resource_keys (
  id             uuid primary key default gen_random_uuid(),
  resource_type  text not null,
  resource_id    uuid not null,
  epoch          int not null default 1,
  wrapped_space  bytea not null,
  space_epoch    int not null default 1,
  created_at     timestamptz not null default now(),
  unique (resource_type, resource_id, epoch)
);

create table if not exists resource_key_wraps (
  id              uuid primary key default gen_random_uuid(),
  resource_key_id uuid not null references resource_keys(id) on delete cascade,
  recipient_id    uuid not null references auth.users(id) on delete cascade,
  sealed          bytea not null,
  granter_id      uuid not null references auth.users(id) on delete cascade,
  signature       bytea not null,
  created_at      timestamptz not null default now(),
  unique (resource_key_id, recipient_id)
);

create index if not exists resource_keys_lookup_idx on resource_keys (resource_type, resource_id);
create index if not exists resource_key_wraps_recipient_idx on resource_key_wraps (recipient_id);

alter table resource_keys enable row level security;
alter table resource_key_wraps enable row level security;

drop policy if exists "resource_keys_owner_all" on resource_keys;
create policy "resource_keys_owner_all" on resource_keys
  for all using (resource_owner(resource_type, resource_id) = auth.uid())
  with check (resource_owner(resource_type, resource_id) = auth.uid());

drop policy if exists "resource_keys_shared_select" on resource_keys;
create policy "resource_keys_shared_select" on resource_keys
  for select using (shared_to_me(resource_type, resource_id));

drop policy if exists "resource_key_wraps_recipient_select" on resource_key_wraps;
create policy "resource_key_wraps_recipient_select" on resource_key_wraps
  for select using (recipient_id = auth.uid());

drop policy if exists "resource_key_wraps_granter_write" on resource_key_wraps;
create policy "resource_key_wraps_granter_write" on resource_key_wraps
  for all using (granter_id = auth.uid()) with check (granter_id = auth.uid());
