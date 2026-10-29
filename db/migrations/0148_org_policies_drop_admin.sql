-- Migration: drop the dead admin branch from the org read policies (review 39-06).
--
-- 0062 removed the admin role and re-created both policies as plain membership
-- checks. 0085 then rewrote them for the statement-scoped auth.uid() pattern and
-- brought back `OR app_role(...) = 'admin'` from an older copy. No profile can
-- hold that role (the role check from 0064 forbids it), so the branch never
-- grants anything; it only costs an app_role() call per row read.
--
-- Same membership check, same initplan form as 0085, without the branch.
-- Reversal: db/migrations-rollback/0148_org_policies_drop_admin.sql.

ALTER POLICY "org_memberships_select_lab" ON public.org_memberships
  USING (is_org_member(org_id, (select auth.uid())));

ALTER POLICY "organizations_select_member" ON public.organizations
  USING (is_org_member(id, (select auth.uid())));
