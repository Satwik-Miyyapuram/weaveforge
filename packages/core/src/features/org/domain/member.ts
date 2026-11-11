/** Types for member. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import { PermissionError, ValidationError } from "../../../shared/errors.js";
import { ORG_INVITE_ROLES } from "./invite-code.js";

/** Academic roles, ordered by rank in {@link ROLE_RANK}. */
export type Role = "professor" | "phd" | "masters" | "standalone";

/** The org roles, without `standalone`: the same list an invite code names. */
export const ROLES: readonly Role[] = ORG_INVITE_ROLES;

/** Higher number = more authority. Used for creation + visibility rules. */
export const ROLE_RANK: Record<Role, number> = {
  standalone: -1,
  masters: 0,
  phd: 1,
  professor: 2,
};

/** Human-readable labels for UI. */
export const ROLE_LABELS: Record<Role, string> = {
  professor: "Professor",
  phd: "PhD supervisor",
  masters: "Master's student",
  standalone: "Standalone",
};

/**
 * A person in the organization. `id` mirrors the Supabase auth user id (so a
 * member is identifiable the same way everywhere). `supervisorId` is the member
 * one level up in the tree, or undefined for professors (tree roots).
 */
export interface Member extends Identifiable {
  id: string;
  email?: string;
  fullName?: string;
  role: Role;
  supervisorId?: string;
  /** False until user creates/joins a lab or chooses standalone mode. */
  orgSetupComplete?: boolean;
  activeOrgId?: string;
}

export interface NewMemberInput {
  email: string;
  password: string;
  fullName?: string;
  role: Role;
  /** Ignored — the creator is always recorded as supervisor server-side. */
  supervisorId?: string;
}

export class MemberValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "MemberValidationError";
  }
}

export class MemberPermissionError extends PermissionError {
  constructor(message: string) {
    super(message);
    this.name = "MemberPermissionError";
  }
}

export interface TeamVisibilityOptions {
  /** Whether the viewer belongs to at least one lab (org_memberships). */
  inLab: boolean;
  /** When set, restrict to members of the active lab. Required when inLab. */
  orgMemberIds?: ReadonlySet<string> | null;
}

