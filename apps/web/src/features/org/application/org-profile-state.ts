import type { Member, OrgMembershipView } from "@weaveforge/core";
import { hasActiveLab, needsStandaloneRoleSync } from "@weaveforge/core";

/**
 * Whether to run the standalone role sync. `labs` is null when the memberships
 * could not be read: unknown is not "no labs", and the sync writes
 * `active_org_id = null` on the server, so it only runs on a real answer.
 */
export function shouldSyncStandalone(profile: Member | null, labs: OrgMembershipView[] | null): boolean {
  if (labs === null) return false;
  return needsStandaloneRoleSync(profile, labs, hasActiveLab(profile?.activeOrgId, labs));
}

/**
 * Whether the first-run setup screen applies. A profile that failed to load is
 * not a missing profile: the setup screen would offer an existing lab member
 * the choices that leave their lab.
 */
export function needsOrgSetup(state: {
  hasOrgs: boolean;
  loading: boolean;
  profile: Member | null;
  error?: string | null;
}): boolean {
  if (!state.hasOrgs || state.loading || state.error) return false;
  return !state.profile || state.profile.orgSetupComplete === false;
}
