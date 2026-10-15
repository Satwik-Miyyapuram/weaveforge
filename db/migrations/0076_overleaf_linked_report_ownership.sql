-- Keep linked reports from referencing a credential owned by another user.
-- The API validates this too; the database policy is the final isolation boundary.
drop policy if exists "overleaf_linked_reports_select_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_select_own" on overleaf_linked_reports
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "overleaf_linked_reports_modify_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_modify_own" on overleaf_linked_reports
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  );
