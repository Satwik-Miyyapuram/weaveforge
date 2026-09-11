/**
 * Organization ("lab") domain — multi-membership via invite codes.
 */

import type { OrgInviteRole } from "./invite-code.js";
import { NotFoundError, PermissionError, ValidationError } from "../../../shared/errors.js";

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

/**
 * A lab rule the caller broke: a missing name, a name that is too long.
 *
 * Distinct from the two below on purpose. `OrgInviteService` currently throws
 * this for "Lab not found." and "Only the lab owner can regenerate codes." too,
 * which is why the same exception surfaced as `400` on one org route and `403`
 * on another — the condition and the class disagreed. Those two sites should
 * throw {@link OrgNotFoundError} / {@link OrgPermissionError}; until they do,
 * this class means only what its name says.
 */
export class OrgValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "OrgValidationError";
  }
}

/** The lab named does not exist. Maps to 404 wherever it is thrown. */
export class OrgNotFoundError extends NotFoundError {
  constructor(message: string) {
    super(message);
    this.name = "OrgNotFoundError";
  }
}

/** The caller is a member of the lab but may not do this. Maps to 403. */
export class OrgPermissionError extends PermissionError {
  constructor(message: string) {
    super(message);
    this.name = "OrgPermissionError";
  }
}

export function validateOrgName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) throw new OrgValidationError("Lab name is required.");
  if (trimmed.length > 120) throw new OrgValidationError("Lab name is too long.");
  return trimmed;
}
