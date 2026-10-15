-- Remove SELECT overlap for own-only tables. The previous FOR ALL mutation
-- policies implicitly applied to SELECT as well as writes, so split them into
-- explicit write policies while keeping the existing select policy unchanged.

-- log_entries
DROP POLICY "log_entries_modify_own" ON public.log_entries;
CREATE POLICY "log_entries_insert_own" ON public.log_entries
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "log_entries_update_own" ON public.log_entries
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "log_entries_delete_own" ON public.log_entries
  FOR DELETE USING ((select auth.uid()) = user_id);

-- paper_relations
DROP POLICY "paper_relations_modify_own" ON public.paper_relations;
CREATE POLICY "paper_relations_insert_own" ON public.paper_relations
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "paper_relations_update_own" ON public.paper_relations
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "paper_relations_delete_own" ON public.paper_relations
  FOR DELETE USING ((select auth.uid()) = user_id);

-- paper_tags
DROP POLICY "paper_tags_modify_own" ON public.paper_tags;
CREATE POLICY "paper_tags_insert_own" ON public.paper_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  );
CREATE POLICY "paper_tags_update_own" ON public.paper_tags
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  );
CREATE POLICY "paper_tags_delete_own" ON public.paper_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.papers p
      WHERE p.id = paper_tags.paper_id
        AND p.user_id = (select auth.uid())
    )
  );

-- project_integrations
DROP POLICY "project_integrations_modify_own" ON public.project_integrations;
CREATE POLICY "project_integrations_insert_own" ON public.project_integrations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  );
CREATE POLICY "project_integrations_update_own" ON public.project_integrations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  );
CREATE POLICY "project_integrations_delete_own" ON public.project_integrations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_integrations.project_id
        AND p.user_id = (select auth.uid())
    )
  );

-- projects
DROP POLICY "projects_modify_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE USING ((select auth.uid()) = user_id);

-- tags
DROP POLICY "tags_modify_own" ON public.tags;
CREATE POLICY "tags_insert_own" ON public.tags
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "tags_update_own" ON public.tags
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "tags_delete_own" ON public.tags
  FOR DELETE USING ((select auth.uid()) = user_id);

-- user_settings
DROP POLICY "user_settings_modify_own" ON public.user_settings;
CREATE POLICY "user_settings_insert_own" ON public.user_settings
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "user_settings_update_own" ON public.user_settings
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "user_settings_delete_own" ON public.user_settings
  FOR DELETE USING ((select auth.uid()) = user_id);
