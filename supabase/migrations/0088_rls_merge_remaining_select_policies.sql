-- Final multiple-permissive-policy cleanup. Merge equivalent SELECT access
-- paths and keep write policies out of SELECT evaluation.

-- blob_objects
DROP POLICY "blob_objects_modify_own" ON public.blob_objects;
DROP POLICY "blob_objects_select_own" ON public.blob_objects;
DROP POLICY "blob_objects_select_shared" ON public.blob_objects;
CREATE POLICY "blob_objects_select_access" ON public.blob_objects
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR blob_shared_to_me(bucket, path)
  );
CREATE POLICY "blob_objects_insert_own" ON public.blob_objects
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "blob_objects_update_own" ON public.blob_objects
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "blob_objects_delete_own" ON public.blob_objects
  FOR DELETE USING ((select auth.uid()) = user_id);

-- reading_list_items
DROP POLICY "reading_list_items_modify_own" ON public.reading_list_items;
DROP POLICY "reading_list_items_select_own" ON public.reading_list_items;
DROP POLICY "reading_list_items_select_shared" ON public.reading_list_items;
CREATE POLICY "reading_list_items_select_access" ON public.reading_list_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
    OR shared_to_me('reading_list', list_id)
  );
CREATE POLICY "reading_list_items_insert_own" ON public.reading_list_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  );
CREATE POLICY "reading_list_items_update_own" ON public.reading_list_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  );
CREATE POLICY "reading_list_items_delete_own" ON public.reading_list_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists l
      WHERE l.id = reading_list_items.list_id
        AND l.user_id = (select auth.uid())
    )
  );

-- vault_pages
DROP POLICY "vault_pages_modify_own" ON public.vault_pages;
DROP POLICY "vault_pages_select_own" ON public.vault_pages;
DROP POLICY "vault_pages_select_shared" ON public.vault_pages;
CREATE POLICY "vault_pages_select_access" ON public.vault_pages
  FOR SELECT USING (
    (select auth.uid()) = user_id
    OR shared_to_me('vault_page', id)
  );
CREATE POLICY "vault_pages_insert_own" ON public.vault_pages
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "vault_pages_update_own" ON public.vault_pages
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "vault_pages_delete_own" ON public.vault_pages
  FOR DELETE USING ((select auth.uid()) = user_id);

-- project_key_wraps and resource_key_wraps
DROP POLICY "project_key_wraps_granter_write" ON public.project_key_wraps;
CREATE POLICY "project_key_wraps_granter_insert" ON public.project_key_wraps
  FOR INSERT WITH CHECK (granter_id = (select auth.uid()));
CREATE POLICY "project_key_wraps_granter_update" ON public.project_key_wraps
  FOR UPDATE USING (granter_id = (select auth.uid()))
  WITH CHECK (granter_id = (select auth.uid()));
CREATE POLICY "project_key_wraps_granter_delete" ON public.project_key_wraps
  FOR DELETE USING (granter_id = (select auth.uid()));

DROP POLICY "resource_key_wraps_granter_write" ON public.resource_key_wraps;
CREATE POLICY "resource_key_wraps_granter_insert" ON public.resource_key_wraps
  FOR INSERT WITH CHECK (granter_id = (select auth.uid()));
CREATE POLICY "resource_key_wraps_granter_update" ON public.resource_key_wraps
  FOR UPDATE USING (granter_id = (select auth.uid()))
  WITH CHECK (granter_id = (select auth.uid()));
CREATE POLICY "resource_key_wraps_granter_delete" ON public.resource_key_wraps
  FOR DELETE USING (granter_id = (select auth.uid()));

-- resource_keys
DROP POLICY "resource_keys_owner_all" ON public.resource_keys;
DROP POLICY "resource_keys_shared_select" ON public.resource_keys;
CREATE POLICY "resource_keys_select_access" ON public.resource_keys
  FOR SELECT USING (
    resource_owner(resource_type, resource_id) = (select auth.uid())
    OR shared_to_me(resource_type, resource_id)
    OR shared_to_me_can_edit(resource_type, resource_id)
  );
CREATE POLICY "resource_keys_owner_insert" ON public.resource_keys
  FOR INSERT WITH CHECK (resource_owner(resource_type, resource_id) = (select auth.uid()));
CREATE POLICY "resource_keys_owner_update" ON public.resource_keys
  FOR UPDATE USING (resource_owner(resource_type, resource_id) = (select auth.uid()))
  WITH CHECK (resource_owner(resource_type, resource_id) = (select auth.uid()));
CREATE POLICY "resource_keys_owner_delete" ON public.resource_keys
  FOR DELETE USING (resource_owner(resource_type, resource_id) = (select auth.uid()));

-- shares
DROP POLICY "shares_owner_all" ON public.shares;
DROP POLICY "shares_recipient_select" ON public.shares;
CREATE POLICY "shares_select_access" ON public.shares
  FOR SELECT USING (
    owner_id = (select auth.uid()) OR recipient_id = (select auth.uid())
  );
CREATE POLICY "shares_owner_insert" ON public.shares
  FOR INSERT WITH CHECK (owner_id = (select auth.uid()));
CREATE POLICY "shares_owner_update" ON public.shares
  FOR UPDATE USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));
CREATE POLICY "shares_owner_delete" ON public.shares
  FOR DELETE USING (owner_id = (select auth.uid()));

-- profiles: combine self, visible, and lab directory access.
DROP POLICY "profiles_select_self" ON public.profiles;
DROP POLICY "profiles_select_lab" ON public.profiles;
DROP POLICY "profiles_select_visible" ON public.profiles;
CREATE POLICY "profiles_select_access" ON public.profiles
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR can_access(user_id)
    OR shares_org_with((select auth.uid()), user_id)
    OR lab_root(user_id) = lab_root((select auth.uid()))
  );
