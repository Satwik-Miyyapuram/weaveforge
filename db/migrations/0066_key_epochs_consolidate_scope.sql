-- Allow the space-epoch consolidation scope in key_epochs RLS.
--
-- ConsolidateProjectSpaceKeyUseCase records resume state under
-- scope = 'project-space-consolidate', scope_id = <project id>. The previous
-- policy only permitted 'user' / 'project' / 'resource' scopes, so both the
-- guard read and the state write returned 403, aborting consolidation.

drop policy if exists "key_epochs_owner_all" on key_epochs;
create policy "key_epochs_owner_all" on key_epochs
  for all using (
    (scope = 'user' and scope_id = auth.uid())
    or (scope in ('project', 'project-space-consolidate') and exists (
      select 1 from projects p where p.id = key_epochs.scope_id and p.user_id = auth.uid()
    ))
    or (scope = 'resource' and resource_owner(
      split_part(reason, ':', 1),
      scope_id
    ) = auth.uid())
  );
