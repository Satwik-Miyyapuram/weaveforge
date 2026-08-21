/**
 * Organization ("lab") domain — multi-membership via invite codes.
 */

import type { OrgInviteRole } from "./invite-code.js";

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export type OrgJoinSource = "legacy" | "invite" | "create";

export interface OrgMembershipView {
  orgId: string;
  orgName: string;
  role: OrgInviteRole;
  joinSource: OrgJoinSource;
}

/** True when the user explicitly created or joined a lab (not migration backfill). */
export function isExplicitLabMembership(m: OrgMembershipView): boolean {
  return m.joinSource === "invite" || m.joinSource === "create";
}

/** Active lab context: selected org must be set and explicitly joined (or owned). */
export function hasActiveLab(
  activeOrgId: string | null | undefined,
  memberships: readonly OrgMembershipView[],
  ownsActiveOrg = false,
): boolean {
  if (!activeOrgId) return false;
  if (ownsActiveOrg) return true;
  return memberships.some((m) => m.orgId === activeOrgId && isExplicitLabMembership(m));
}

/** Codes returned in plaintext only at create/regenerate time. */
export interface OrgInviteCodePlaintext {
  targetRole: OrgInviteRole;
  code: string;
}

export class OrgValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgValidationError";
  }
}

export function validateOrgName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) throw new OrgValidationError("Lab name is required.");
  if (trimmed.length > 120) throw new OrgValidationError("Lab name is too long.");
  return trimmed;
}
