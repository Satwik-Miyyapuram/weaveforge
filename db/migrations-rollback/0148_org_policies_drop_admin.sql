-- Undo 0148 — put the admin branch back in the org read policies, as 0085 had them.
--
-- Lossless: no role can be `admin`, so the branch grants nothing either way.
-- Safe to run more than once.

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
