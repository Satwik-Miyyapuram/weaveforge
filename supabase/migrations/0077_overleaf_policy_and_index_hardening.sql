-- Make Overleaf RLS policy actions explicit instead of combining SELECT with
-- a broad FOR ALL policy. This preserves the same owner checks while avoiding
-- redundant permissive SELECT policies.

create index if not exists overleaf_linked_reports_connection_idx
  on overleaf_linked_reports (connection_id);

drop policy if exists "overleaf_connections_select_own" on overleaf_connections;
drop policy if exists "overleaf_connections_modify_own" on overleaf_connections;

create policy "overleaf_connections_select_own" on overleaf_connections
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "overleaf_connections_insert_own" on overleaf_connections
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "overleaf_connections_update_own" on overleaf_connections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "overleaf_connections_delete_own" on overleaf_connections
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "overleaf_linked_reports_select_own" on overleaf_linked_reports;
drop policy if exists "overleaf_linked_reports_modify_own" on overleaf_linked_reports;

create policy "overleaf_linked_reports_select_own" on overleaf_linked_reports
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  );
create policy "overleaf_linked_reports_insert_own" on overleaf_linked_reports
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  );
create policy "overleaf_linked_reports_update_own" on overleaf_linked_reports
  for update to authenticated
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
create policy "overleaf_linked_reports_delete_own" on overleaf_linked_reports
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
  );
