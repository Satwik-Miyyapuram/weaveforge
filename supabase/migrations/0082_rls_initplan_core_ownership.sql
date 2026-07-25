-- Phase 2 RLS performance cleanup.
-- Keep policy names, roles, commands, and authorization predicates unchanged;
-- only make auth.uid() statement-scoped so the planner does not evaluate it
-- once per row.

ALTER POLICY "papers_select_own" ON public.papers
  USING ((select auth.uid()) = user_id);
ALTER POLICY "papers_modify_own" ON public.papers
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "log_entries_select_own" ON public.log_entries
  USING ((select auth.uid()) = user_id);
ALTER POLICY "log_entries_modify_own" ON public.log_entries
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "report_sections_select_own" ON public.report_sections
  USING ((select auth.uid()) = user_id);
ALTER POLICY "report_sections_modify_own" ON public.report_sections
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "projects_select_own" ON public.projects
  USING ((select auth.uid()) = user_id);
ALTER POLICY "projects_modify_own" ON public.projects
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "experiments_select_own" ON public.experiments
  USING ((select auth.uid()) = user_id);
ALTER POLICY "experiments_modify_own" ON public.experiments
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "experiment_metrics_select_own" ON public.experiment_metrics
  USING ((select auth.uid()) = user_id);
ALTER POLICY "experiment_metrics_modify_own" ON public.experiment_metrics
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "milestones_select_own" ON public.milestones
  USING ((select auth.uid()) = user_id);
ALTER POLICY "milestones_modify_own" ON public.milestones
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "tags_select_own" ON public.tags
  USING ((select auth.uid()) = user_id);
ALTER POLICY "tags_modify_own" ON public.tags
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY library_pins_own ON public.library_pins
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "vault_pages_select_own" ON public.vault_pages
  USING ((select auth.uid()) = user_id);
ALTER POLICY "vault_pages_modify_own" ON public.vault_pages
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "user_keys_owner" ON public.user_keys
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "share_links_owner_all" ON public.share_links
  USING ((select auth.uid()) = owner_id)
  WITH CHECK ((select auth.uid()) = owner_id);
