/**
 * Org invite roles and the invite error type. The invite-code rules (Crockford
 * base32 format, typo-tolerant normalization, join assignment) are Rust, in
 * wf-core `org`.
 */
import { ValidationError } from "../../../shared/errors.js";

export const ORG_INVITE_ROLES = ["professor", "phd", "masters"] as const;

export type OrgInviteRole = (typeof ORG_INVITE_ROLES)[number];

export class OrgInviteValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "OrgInviteValidationError";
  }
}
