-- Rollback for db/migrations/0142_project_ownership_policies.sql.
--
-- Lossless in data, a regression in security: users can again write rows that
-- name somebody else's project or paper, and a reviewer can again move or
-- delete a decision on a list they cannot see. Restores the policies exactly
-- as 0077, 0102, 0103, 0104, 0107, 0110 and 0120 created them.

-- 1. user_id-only policies (0102, 0103, 0104 applied to every role; 0107 and
--    0110 to authenticated).
drop policy if exists citation_alert_tracks_own on citation_alert_tracks;
create policy citation_alert_tracks_own on citation_alert_tracks
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists annotation_pins_own on annotation_pins;
create policy annotation_pins_own on annotation_pins
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists paper_field_defs_own on paper_field_defs;
create policy paper_field_defs_own on paper_field_defs
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists paper_field_values_own on paper_field_values;
create policy paper_field_values_own on paper_field_values
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists annotation_quotation_types_own on annotation_quotation_types;
create policy annotation_quotation_types_own on annotation_quotation_types
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists reader_annotations_own on reader_annotations;
create policy reader_annotations_own on reader_annotations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. overleaf_linked_reports (0077).
drop policy if exists "overleaf_linked_reports_insert_own" on overleaf_linked_reports;
create policy "overleaf_linked_reports_insert_own" on overleaf_linked_reports
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from overleaf_connections c
      where c.id = connection_id and c.user_id = (select auth.uid())
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
  );

-- 3. screening_decisions (0120).
drop policy if exists "screening_decisions_update_own" on screening_decisions;
create policy "screening_decisions_update_own" on screening_decisions
  for update using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid()));

drop policy if exists "screening_decisions_delete_own" on screening_decisions;
create policy "screening_decisions_delete_own" on screening_decisions
  for delete using (reviewer_id = (select auth.uid()));
