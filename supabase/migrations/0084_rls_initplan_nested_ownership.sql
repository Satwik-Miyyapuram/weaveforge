-- Phase 4 RLS performance cleanup for simple nested ownership predicates.

ALTER POLICY "reading_list_items_select_own" ON public.reading_list_items
  USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  );
ALTER POLICY "reading_list_items_modify_own" ON public.reading_list_items
  USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  );

ALTER POLICY "project_integrations_select_own" ON public.project_integrations
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  );
ALTER POLICY "project_integrations_modify_own" ON public.project_integrations
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  );

ALTER POLICY "paper_tags_select_own" ON public.paper_tags
  USING (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  );
ALTER POLICY "paper_tags_modify_own" ON public.paper_tags
  USING (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  );
