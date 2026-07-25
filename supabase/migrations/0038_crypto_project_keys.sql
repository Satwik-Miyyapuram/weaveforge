-- Project space keys + member/supervision wraps (plan §6 migration 0038).

create table if not exists project_keys (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  epoch      int not null default 1,
  created_at timestamptz not null default now(),
  unique (project_id, epoch)
);

create table if not exists project_key_wraps (
  id              uuid primary key default gen_random_uuid(),
  project_key_id  uuid not null references project_keys(id) on delete cascade,
  recipient_id    uuid not null references auth.users(id) on delete cascade,
  scope           text not null check (scope in ('member', 'supervision')),
  sealed          bytea not null,
  granter_id      uuid not null references auth.users(id) on delete cascade,
  signature       bytea not null,
  created_at      timestamptz not null default now(),
  unique (project_key_id, recipient_id, scope)
);

create index if not exists project_keys_project_idx on project_keys (project_id);
create index if not exists project_key_wraps_recipient_idx on project_key_wraps (recipient_id);

alter table project_keys enable row level security;
alter table project_key_wraps enable row level security;

drop policy if exists "project_keys_owner_select" on project_keys;
create policy "project_keys_owner_select" on project_keys
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_keys.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "project_keys_owner_write" on project_keys;
create policy "project_keys_owner_write" on project_keys
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = project_keys.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "project_key_wraps_recipient_select" on project_key_wraps;
create policy "project_key_wraps_recipient_select" on project_key_wraps
  for select using (recipient_id = auth.uid());

drop policy if exists "project_key_wraps_granter_write" on project_key_wraps;
create policy "project_key_wraps_granter_write" on project_key_wraps
  for all using (granter_id = auth.uid()) with check (granter_id = auth.uid());
