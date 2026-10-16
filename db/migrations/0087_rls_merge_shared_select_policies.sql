-- Merge owner/shared SELECT policies for core shared resources and keep
-- mutation policies out of SELECT evaluation.

-- experiments
DROP POLICY "experiments_modify_own" ON public.experiments;
DROP POLICY "experiments_select_own" ON public.experiments;
DROP POLICY "experiments_select_shared" ON public.experiments;
CREATE POLICY "experiments_select_access" ON public.experiments
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('experiment', id)
  );
CREATE POLICY "experiments_insert_own" ON public.experiments
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "experiments_update_own" ON public.experiments
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "experiments_delete_own" ON public.experiments
  FOR DELETE USING ((select auth.uid()) = user_id);

-- experiment_metrics
DROP POLICY "experiment_metrics_modify_own" ON public.experiment_metrics;
DROP POLICY "experiment_metrics_select_own" ON public.experiment_metrics;
DROP POLICY "experiment_metrics_select_shared" ON public.experiment_metrics;
CREATE POLICY "experiment_metrics_select_access" ON public.experiment_metrics
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('experiment', experiment_id)
  );
CREATE POLICY "experiment_metrics_insert_own" ON public.experiment_metrics
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "experiment_metrics_update_own" ON public.experiment_metrics
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "experiment_metrics_delete_own" ON public.experiment_metrics
  FOR DELETE USING ((select auth.uid()) = user_id);

-- milestones
DROP POLICY "milestones_modify_own" ON public.milestones;
DROP POLICY "milestones_select_own" ON public.milestones;
DROP POLICY "milestones_select_shared" ON public.milestones;
CREATE POLICY "milestones_select_access" ON public.milestones
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('milestone', id)
  );
CREATE POLICY "milestones_insert_own" ON public.milestones
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "milestones_update_own" ON public.milestones
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "milestones_delete_own" ON public.milestones
  FOR DELETE USING ((select auth.uid()) = user_id);

-- papers
DROP POLICY "papers_modify_own" ON public.papers;
DROP POLICY "papers_select_own" ON public.papers;
DROP POLICY "papers_select_shared" ON public.papers;
CREATE POLICY "papers_select_access" ON public.papers
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('paper', id)
  );
CREATE POLICY "papers_insert_own" ON public.papers
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "papers_update_own" ON public.papers
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "papers_delete_own" ON public.papers
  FOR DELETE USING ((select auth.uid()) = user_id);

-- reading_lists
DROP POLICY "reading_lists_modify_own" ON public.reading_lists;
DROP POLICY "reading_lists_select_own" ON public.reading_lists;
DROP POLICY "reading_lists_select_shared" ON public.reading_lists;
CREATE POLICY "reading_lists_select_access" ON public.reading_lists
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('reading_list', id)
  );
CREATE POLICY "reading_lists_insert_own" ON public.reading_lists
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "reading_lists_update_own" ON public.reading_lists
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "reading_lists_delete_own" ON public.reading_lists
  FOR DELETE USING ((select auth.uid()) = user_id);

-- report_sections
DROP POLICY "report_sections_modify_own" ON public.report_sections;
DROP POLICY "report_sections_select_own" ON public.report_sections;
DROP POLICY "report_sections_select_shared" ON public.report_sections;
CREATE POLICY "report_sections_select_access" ON public.report_sections
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('report_section', id)
  );
CREATE POLICY "report_sections_insert_own" ON public.report_sections
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "report_sections_update_own" ON public.report_sections
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "report_sections_delete_own" ON public.report_sections
  FOR DELETE USING ((select auth.uid()) = user_id);
