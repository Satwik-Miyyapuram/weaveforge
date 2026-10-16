-- Widen share access to include collaborative edit (plan §6 migration 0043).

alter table shares drop constraint if exists shares_access_check;
alter table shares add constraint shares_access_check
  check (access in ('view', 'comment', 'edit'));

create or replace function shared_to_me_can_edit(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from shares s
    where s.recipient_id = auth.uid()
      and s.resource_type = rtype
      and s.access = 'edit'
      and (s.resource_id = rid or s.resource_id is null)
      and s.owner_id = resource_owner(rtype, rid)
  )
$$;

create or replace function can_edit_resource(rtype text, rid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when resource_owner(rtype, rid) = auth.uid() then true
    else shared_to_me_can_edit(rtype, rid)
  end
$$;

-- CRDT insert policy (0042 creates table; can_edit_resource must exist first).
drop policy if exists "crdt_updates_insert_edit" on crdt_updates;
create policy "crdt_updates_insert_edit" on crdt_updates
  for insert with check (
    author_id = auth.uid()
    and can_edit_resource(resource_type, resource_id)
  );

-- Resource-scoped key_epochs rows for per-resource rekey tracking (was 0043b).
drop policy if exists "key_epochs_owner_all" on key_epochs;
create policy "key_epochs_owner_all" on key_epochs
  for all using (
    (scope = 'user' and scope_id = auth.uid())
    or (scope = 'project' and exists (
      select 1 from projects p where p.id = key_epochs.scope_id and p.user_id = auth.uid()
    ))
    or (scope = 'resource' and resource_owner(
      split_part(reason, ':', 1),
      scope_id
    ) = auth.uid())
  );
