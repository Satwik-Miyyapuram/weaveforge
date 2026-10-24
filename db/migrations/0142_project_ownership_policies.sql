-- Row policies check who owns the project, paper and list a row points at,
-- not only the row's own user column.
--
-- A foreign key ignores RLS, so a policy that checks only `user_id` lets a
-- user insert a row naming somebody else's project or paper. With the unique
-- keys on these tables, that row then blocks the owner from creating their own
-- (squatting), and the owner's delete cascades into a row they cannot see.
--
-- 1. citation_alert_tracks (0102), annotation_pins (0103), paper_field_values
--    (0104), annotation_quotation_types (0107), reader_annotations (0110):
--    the project and the paper must be the caller's, and the paper must sit in
--    that project or in none (a library paper). The pattern of 0106.
-- 2. paper_field_defs (0104): the project must be the caller's.
-- 3. overleaf_linked_reports (0077): insert and update also check the project.
-- 4. screening_decisions (0120): update and delete also require the item to be
--    on a list the reviewer can still see, as insert already does. Without
--    it, an unfiltered update could move a decision onto a hidden list, and
--    update and delete kept working after the list was unshared.
--
-- Projects cannot be shared (`resource_owner` has no 'project' type), so
-- owning the project is the whole rule. Review rows 39-04, 40-05, 40-06.
--
-- Rollback: db/migrations-rollback/0142_project_ownership_policies.sql.

-- 1. -------------------------------------------------------------------------

do $$
declare
  t text;
  owned text;
begin
  foreach t in array array[
    'citation_alert_tracks',
    'annotation_pins',
    'paper_field_values',
    'annotation_quotation_types',
    'reader_annotations'
  ] loop
    owned := format($f$
      user_id = (select auth.uid())
      and exists (
        select 1 from projects p
        where p.id = %1$I.project_id and p.user_id = (select auth.uid())
      )
      and exists (
        select 1 from papers pap
        where pap.id = %1$I.paper_id
          and pap.user_id = (select auth.uid())
          and (pap.project_id = %1$I.project_id or pap.project_id is null)
      )$f$, t);

    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format(
      'create policy %I on %I for all to authenticated using (%s) with check (%s)',
      t || '_own', t, owned, owned
    );
  end loop;
end
$$;

-- 2. -------------------------------------------------------------------------

drop policy if exists paper_field_defs_own on paper_field_defs;
create policy paper_field_defs_own on paper_field_defs
  for all
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from projects p
      where p.id = paper_field_defs.project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from projects p
      where p.id = paper_field_defs.project_id and p.user_id = (select auth.uid())
    )
  );

-- 3. -------------------------------------------------------------------------

drop policy if exists "overleaf_linked_reports_insert_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_insert_own" on overleaf_linked_reports
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "overleaf_linked_reports_update_own" on overleaf_linked_reports;
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
    and exists (
      select 1 from projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

-- 4. -------------------------------------------------------------------------

drop policy if exists "screening_decisions_update_own" on screening_decisions;
create policy "screening_decisions_update_own" on screening_decisions
  for update
  using (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.reading_list_items i
      join public.reading_lists l on l.id = i.list_id
      where i.id = screening_decisions.item_id
        and (l.user_id = (select auth.uid()) or shared_to_me('reading_list', i.list_id))
    )
  )
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.reading_list_items i
      join public.reading_lists l on l.id = i.list_id
      where i.id = screening_decisions.item_id
        and (l.user_id = (select auth.uid()) or shared_to_me('reading_list', i.list_id))
    )
  );

drop policy if exists "screening_decisions_delete_own" on screening_decisions;
create policy "screening_decisions_delete_own" on screening_decisions
  for delete
  using (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.reading_list_items i
      join public.reading_lists l on l.id = i.list_id
      where i.id = screening_decisions.item_id
        and (l.user_id = (select auth.uid()) or shared_to_me('reading_list', i.list_id))
    )
  );
