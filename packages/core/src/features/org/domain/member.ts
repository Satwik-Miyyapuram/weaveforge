/**
 * Organization domain model: the types, error classes and role constants for lab
 * members. The rules (visibility, account creation, role display, validation) are
 * Rust, in wf-core `member`; this module calls them through `rust()`.
 *
 * The academic hierarchy: a professor supervises PhD students, and a PhD student
 * supervises masters students. A member's `supervisorId` points at the member one
 * level up, so the whole organization is a tree rooted at professors.
 */

import type { Identifiable } from "../../../shared/repository.js";
import { PermissionError, ValidationError } from "../../../shared/errors.js";
import { rust } from "../../../shared/rust.js";
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

/** Roles a member of the given role is allowed to create (strictly lower rank). */
export function creatableRoles(creator: Role): Role[] {
  return rust().creatableRoles(creator) as Role[];
}

/** Whether `creator` may provision an account with role `target`. */
export function canCreateRole(creator: Role, target: Role): boolean {
  return rust().canCreateRole(creator, target);
}

/** New members are always supervised by whoever created them. */
export function resolveSupervisorId(creator: Member, _input: NewMemberInput): string {
  return rust().resolveSupervisorId(creator.id);
}

/** Validate + normalize a new-member request. Throws on invalid input. */
export function validateNewMember(input: NewMemberInput): NewMemberInput {
  try {
    const normalized = rust().validateNewMember({
      email: input.email ?? "",
      password: input.password ?? "",
      fullName: input.fullName,
      role: input.role ?? "",
      supervisorId: input.supervisorId,
    });
    return {
      email: normalized.email,
      password: normalized.password,
      fullName: normalized.fullName ?? undefined,
      role: normalized.role as Role,
      supervisorId: normalized.supervisorId ?? undefined,
    };
  } catch (error) {
    // Rust rejects with the message string (wf-wasm throws a JS string).
    if (typeof error === "string") throw new MemberValidationError(error);
    throw error;
  }
}

export interface TeamVisibilityOptions {
  /** Whether the viewer belongs to at least one lab (org_memberships). */
  inLab: boolean;
  /** When set, restrict to members of the active lab. Required when inLab. */
  orgMemberIds?: ReadonlySet<string> | null;
}

/**
 * Subtree visibility: viewer plus all supervisees (transitively). Used for
 * supervision dashboards — not the org chart (see filterLabMembers).
 *
 * Standalone users (no lab) see only themselves — not every profile the DB
 * policy may expose via legacy lab_root.
 */
export function filterTeamMembers(
  viewerId: string,
  members: readonly Member[],
  options: TeamVisibilityOptions,
): Member[] {
  return rust().filterTeamMembers(viewerId, members, options);
}

/**
 * Full lab roster for the org chart: everyone in the active lab, including
 * supervisors and peers above the viewer in the hierarchy.
 */
export function filterLabMembers(
  viewerId: string,
  members: readonly Member[],
  options: TeamVisibilityOptions,
): Member[] {
  return rust().filterLabMembers(viewerId, members, options);
}

/** Whether the role can supervise others (rank above masters). */
export function isSupervisorRole(role: Role | null | undefined): boolean {
  return rust().isSupervisorRole(role);
}

/** Role label context — standalone users are not masters/phd in the UI. */
export function resolveDisplayRole(role: Role, opts: { inLab: boolean; ownsOrg?: boolean }): Role {
  return rust().resolveDisplayRole(role, opts) as Role;
}

export function memberRoleLabel(member: Pick<Member, "role">, opts: { inLab: boolean; ownsOrg?: boolean }): string {
  return ROLE_LABELS[resolveDisplayRole(member.role, opts)];
}

/** True when profiles.role should be persisted as standalone (stale lab role). */
export function needsStandaloneRoleSync(
  profile: Pick<Member, "role" | "orgSetupComplete"> | null,
  memberships: readonly { joinSource?: string }[],
  inLab: boolean,
): boolean {
  return rust().needsStandaloneRoleSync(profile, memberships, inLab);
}
