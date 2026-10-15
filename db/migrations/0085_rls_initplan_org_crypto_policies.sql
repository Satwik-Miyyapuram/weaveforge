-- Phase 5 RLS performance cleanup for organization, crypto, and CRDT policies.
-- Authorization helper calls are unchanged; only auth.uid() is statement-scoped.

ALTER POLICY "profiles_select_self" ON public.profiles
  USING (user_id = (select auth.uid()));

ALTER POLICY "profiles_select_lab" ON public.profiles
  USING (
    shares_org_with((select auth.uid()), user_id)
    OR lab_root(user_id) = lab_root((select auth.uid()))
  );

ALTER POLICY "org_memberships_select_lab" ON public.org_memberships
  USING (
    is_org_member(org_id, (select auth.uid()))
    OR app_role((select auth.uid())) = 'admin'
  );

ALTER POLICY "organizations_select_member" ON public.organizations
  USING (
    is_org_member(id, (select auth.uid()))
    OR app_role((select auth.uid())) = 'admin'
  );

ALTER POLICY "project_keys_owner_select" ON public.project_keys
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_keys.project_id
        AND p.user_id = (select auth.uid())
    )
  );

ALTER POLICY "project_keys_owner_write" ON public.project_keys
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_keys.project_id
        AND p.user_id = (select auth.uid())
    )
  );

ALTER POLICY "crdt_updates_delete_owner" ON public.crdt_updates
  USING (resource_owner(resource_type, resource_id) = (select auth.uid()));

ALTER POLICY "crdt_updates_insert_edit" ON public.crdt_updates
  WITH CHECK (
    author_id = (select auth.uid())
    AND can_edit_resource(resource_type, resource_id)
  );

ALTER POLICY "key_epochs_owner_all" ON public.key_epochs
  USING (
    (scope = 'user' AND scope_id = (select auth.uid()))
    OR (scope = 'project' AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = key_epochs.scope_id
        AND p.user_id = (select auth.uid())
    ))
    OR (scope = 'resource' AND resource_owner(
      split_part(reason, ':', 1),
      scope_id
    ) = (select auth.uid()))
  );
