import type { OrgInviteRole, OrgMembershipView } from "@weaveforge/core";

/** The `org_memberships` columns both the client and the admin path select. */
export const MEMBERSHIP_ROW_COLUMNS = "org_id, role, joined_via, organizations(name)";

/**
 * One membership row as the app models it.
 *
 * PostgREST returns the embedded organisation as an object or a one-element
 * array depending on how it resolves the relationship, and `joined_via` is
 * absent on rows written before it existed — so both are narrowed here rather
 * than in each caller.
 */
export function membershipViewFromRow(row: {
  org_id: string;
  role: string;
  joined_via?: string;
  organizations?: { name: string } | { name: string }[] | null;
}): OrgMembershipView {
  const org = row.organizations;
  const name = Array.isArray(org) ? org[0]?.name : org?.name;
  const joinedVia = row.joined_via;
  return {
    orgId: row.org_id,
    orgName: name ?? "Lab",
    role: row.role as OrgInviteRole,
    joinSource: joinedVia === "invite" || joinedVia === "create" ? joinedVia : "legacy",
  };
}
