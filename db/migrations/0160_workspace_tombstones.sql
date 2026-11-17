-- Workspace tombstones: a lowered workspace's server copies are removed and its
-- epoch is recorded here, so a stale upload from an older epoch is refused.
--
-- One row per (owner, workspace). The epoch only moves up: the RPC keeps the
-- highest value, so a replayed DELETE with a lower epoch cannot reopen it.

create table if not exists workspace_tombstones (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id text not null,
  epoch bigint not null check (epoch >= 0),
  deleted_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

alter table workspace_tombstones enable row level security;

drop policy if exists workspace_tombstones_own on workspace_tombstones;
create policy workspace_tombstones_own on workspace_tombstones
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on workspace_tombstones to authenticated;

create or replace function record_workspace_tombstone(p_workspace_id text, p_epoch bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into workspace_tombstones (user_id, workspace_id, epoch)
  values (auth.uid(), p_workspace_id, p_epoch)
  on conflict (user_id, workspace_id) do update
    set epoch = greatest(workspace_tombstones.epoch, excluded.epoch),
        deleted_at = now();
end;
$$;

revoke all on function record_workspace_tombstone(text, bigint) from public, anon;
grant execute on function record_workspace_tombstone(text, bigint) to authenticated;

notify pgrst, 'reload schema';
