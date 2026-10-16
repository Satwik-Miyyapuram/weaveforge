-- Restore the project-space consolidation scope removed by migration 0085.
-- This keeps consolidation limited to projects owned by the authenticated user.

drop policy if exists "key_epochs_owner_all" on public.key_epochs;
create policy "key_epochs_owner_all" on public.key_epochs
  for all
  using (
    (scope = 'user' and scope_id = (select auth.uid()))
    or (scope in ('project', 'project-space-consolidate') and exists (
      select 1 from public.projects p
      where p.id = key_epochs.scope_id
        and p.user_id = (select auth.uid())
    ))
    or (scope = 'resource' and resource_owner(
      split_part(reason, ':', 1),
      scope_id
    ) = (select auth.uid()))
  )
  with check (
    (scope = 'user' and scope_id = (select auth.uid()))
    or (scope in ('project', 'project-space-consolidate') and exists (
      select 1 from public.projects p
      where p.id = key_epochs.scope_id
        and p.user_id = (select auth.uid())
    ))
    or (scope = 'resource' and resource_owner(
      split_part(reason, ':', 1),
      scope_id
    ) = (select auth.uid()))
  );
