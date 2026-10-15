-- CRDT update log for encrypted collaborative editing (plan §6 migration 0042).

create table if not exists crdt_updates (
  id              bigint generated always as identity primary key,
  resource_type   text not null,
  resource_id     uuid not null,
  project_id      uuid references projects(id) on delete cascade,
  epoch           int not null default 1,
  payload         bytea not null,
  author_id       uuid not null references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create index if not exists crdt_updates_resource_idx
  on crdt_updates (resource_type, resource_id, id);

alter table vault_pages
  add column if not exists snapshot_upto bigint;

alter table report_sections
  add column if not exists snapshot_upto bigint;

alter table log_entries
  add column if not exists snapshot_upto bigint;

alter table crdt_updates enable row level security;

drop policy if exists "crdt_updates_select_visible" on crdt_updates;
create policy "crdt_updates_select_visible" on crdt_updates
  for select using (can_view_resource(resource_type, resource_id));

-- Insert policy is in 0043_shares_edit_access.sql (needs can_edit_resource).

drop policy if exists "crdt_updates_delete_owner" on crdt_updates;
create policy "crdt_updates_delete_owner" on crdt_updates
  for delete using (resource_owner(resource_type, resource_id) = auth.uid());
