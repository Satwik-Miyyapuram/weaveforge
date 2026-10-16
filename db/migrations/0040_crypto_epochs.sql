-- Resumable rekey / migration state (plan §6 migration 0040).

create table if not exists key_epochs (
  scope       text not null,
  scope_id    uuid not null,
  epoch       int not null,
  reason      text not null default '',
  rekey_state text not null default 'pending'
                check (rekey_state in ('pending', 'running', 'done')),
  updated_at  timestamptz not null default now(),
  primary key (scope, scope_id)
);

alter table key_epochs enable row level security;

drop policy if exists "key_epochs_owner_all" on key_epochs;
create policy "key_epochs_owner_all" on key_epochs
  for all using (
    (scope = 'user' and scope_id = auth.uid())
    or (scope = 'project' and exists (
      select 1 from projects p where p.id = key_epochs.scope_id and p.user_id = auth.uid()
    ))
  );
