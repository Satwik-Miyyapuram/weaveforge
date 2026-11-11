/** Types for organization. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

/** Codes returned in plaintext only at create/regenerate time. */
export interface OrgInviteCodePlaintext {
  targetRole: OrgInviteRole;
  code: string;
}

/**
 * A lab rule the caller broke: a missing name, a name that is too long.
 *
 * Distinct from the two below on purpose: a missing lab is
 * {@link OrgNotFoundError} (404) and a non-owner is {@link OrgPermissionError}
 * (403), so each org route answers the same condition with the same status.
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


