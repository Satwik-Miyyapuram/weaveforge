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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface MemberFns {
  /** Roles a member of the given role is allowed to create (strictly lower rank). */
  creatableRoles(creator: Role): Role[];
  /** Whether `creator` may provision an account with role `target`. */
  canCreateRole(creator: Role, target: Role): boolean;
  /** New members are always supervised by whoever created them. */
  resolveSupervisorId(creatorId: string): string;
  /** Validate + normalize a new-member request. Throws on invalid input. */
  validateNewMember(input: NewMemberInput): NewMemberInput;
  /**
 * Subtree visibility: viewer plus all supervisees (transitively). Used for
 * supervision dashboards — not the org chart (see filterLabMembers).
 *
 * Standalone users (no lab) see only themselves — not every profile the DB
 * policy may expose via legacy lab_root.
 */
  filterTeamMembers(viewerId: string, members: readonly Member[], options: TeamVisibilityOptions): Member[];
  /**
 * Full lab roster for the org chart: everyone in the active lab, including
 * supervisors and peers above the viewer in the hierarchy.
 */
  filterLabMembers(viewerId: string, members: readonly Member[], options: TeamVisibilityOptions): Member[];
  /** Whether the role can supervise others (rank above masters). */
  isSupervisorRole(role: Role | null | undefined): boolean;
  /** Role label context — standalone users are not masters/phd in the UI. */
  resolveDisplayRole(role: Role, opts: { inLab: boolean; ownsOrg?: boolean }): Role;
  memberRoleLabel(member: Pick<Member, "role">, opts: { inLab: boolean; ownsOrg?: boolean }): string;
  /** True when profiles.role should be persisted as standalone (stale lab role). */
  needsStandaloneRoleSync(profile: Pick<Member, "role" | "orgSetupComplete"> | null, memberships: readonly { joinSource?: string }[], inLab: boolean): boolean;
}
