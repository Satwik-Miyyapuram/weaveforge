-- Phase 3 RLS performance cleanup for direct ownership and sharing predicates.

ALTER POLICY "reading_lists_select_own" ON public.reading_lists
  USING ((select auth.uid()) = user_id);
ALTER POLICY "reading_lists_modify_own" ON public.reading_lists
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "paper_relations_select_own" ON public.paper_relations
  USING ((select auth.uid()) = user_id);
ALTER POLICY "paper_relations_modify_own" ON public.paper_relations
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "user_settings_select_own" ON public.user_settings
  USING ((select auth.uid()) = user_id);
ALTER POLICY "user_settings_modify_own" ON public.user_settings
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "blob_objects_select_own" ON public.blob_objects
  USING ((select auth.uid()) = user_id);
ALTER POLICY "blob_objects_modify_own" ON public.blob_objects
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "shares_owner_all" ON public.shares
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));
ALTER POLICY "shares_recipient_select" ON public.shares
  USING (recipient_id = (select auth.uid()));

ALTER POLICY "comments_insert_allowed" ON public.comments
  WITH CHECK (author_id = (select auth.uid()) and can_comment_resource(resource_type, resource_id));
ALTER POLICY "comments_delete_own" ON public.comments
  USING (author_id = (select auth.uid()));

ALTER POLICY "project_key_wraps_recipient_select" ON public.project_key_wraps
  USING (recipient_id = (select auth.uid()));
ALTER POLICY "project_key_wraps_granter_write" ON public.project_key_wraps
  USING (granter_id = (select auth.uid()))
  WITH CHECK (granter_id = (select auth.uid()));

ALTER POLICY "resource_keys_owner_all" ON public.resource_keys
  USING (resource_owner(resource_type, resource_id) = (select auth.uid()))
  WITH CHECK (resource_owner(resource_type, resource_id) = (select auth.uid()));
ALTER POLICY "resource_key_wraps_recipient_select" ON public.resource_key_wraps
  USING (recipient_id = (select auth.uid()));
ALTER POLICY "resource_key_wraps_granter_write" ON public.resource_key_wraps
  USING (granter_id = (select auth.uid()))
  WITH CHECK (granter_id = (select auth.uid()));

ALTER POLICY "api_tokens_owner_all" ON public.api_tokens
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));
