/**
 * Lab member and org rules (Rust `member` and `org`), re-exported from index.ts. Keeps
 * the signatures of the functions in packages/core/src/features/org/domain/ and
 * apps/web/src/features/org/application/ that they replace. Functions that return
 * members return them from the input array (the Rust side returns indices).
 */
import {
  resolveOrgJoinAssignment as rawResolveOrgJoinAssignment,
  validateNewMember as rawValidateNewMember,
  filterLabMembers as rawFilterLabMembers,
  filterTeamMembers as rawFilterTeamMembers,
  hasActiveLab as rawHasActiveLab,
  isSupervisorRole as rawIsSupervisorRole,
  roleRank as rawRoleRank,
  resolveDisplayRole as rawResolveDisplayRole,
  studentsOf as rawStudentsOf,
} from "../pkg/wf_wasm.js";

import type {
  JoinAssignment,
  MemberLink,
  Membership,
  NewMember,
} from "./bindings.js";

export {
  needsStandaloneRoleSync,
  shouldSyncStandalone,
} from "../pkg/wf_wasm.js";

export {
  canCreateRole,
  creatableRoles,
  formatInviteCode,
  isExplicitLabMembership,
  isMissingServiceRole,
  needsMigrationHint,
  needsOrgSetup,
  normalizeOrgInviteCode,
  resolveSupervisorId,
  validateOrgName,
} from "../pkg/wf_wasm.js";

/** What a viewer may see of a lab. `orgMemberIds` is the active lab's roster, if known. */
function wireVisibility(options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null }) {
  return {
    inLab: options.inLab,
    orgMemberIds: options.orgMemberIds ? [...options.orgMemberIds] : null,
  };
}

function pick<T>(items: readonly T[], indices: readonly number[]): T[] {
  return indices.map((i) => items[i] as T);
}

/** The supervision team: the viewer plus all supervisees, at any depth. */
export function filterTeamMembers<T extends MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[] {
  return pick(members, rawFilterTeamMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The full active-lab roster, for the org chart. */
export function filterLabMembers<T extends MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[] {
  return pick(members, rawFilterLabMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The people below `viewerId` in the supervisor tree, at any depth. */
export function studentsOf<T extends MemberLink>(viewerId: string | undefined, team: readonly T[]): T[] {
  return pick(team, rawStudentsOf(viewerId ?? undefined, team) as number[]);
}

/** Rank of a role: standalone -1, masters 0, phd 1, professor 2. `undefined` for an unknown role. */
export function roleRank(role: string): number | undefined {
  return rawRoleRank(role) ?? undefined;
}

/** Whether a role can supervise others (rank above masters). */
export function isSupervisorRole(role: string | null | undefined): boolean {
  return rawIsSupervisorRole(role ?? undefined);
}

/** Role shown for a member: standalone outside a lab, except an owner's professor. */
export function resolveDisplayRole(
  role: string,
  opts: { inLab: boolean; ownsOrg?: boolean },
): string {
  return rawResolveDisplayRole(role, opts.inLab, opts.ownsOrg ?? false);
}

/** Whether the active lab is set and the user is explicitly in it, or owns it. */
export function hasActiveLab(
  activeOrgId: string | null | undefined,
  memberships: readonly Membership[],
  ownsActiveOrg = false,
): boolean {
  return rawHasActiveLab(activeOrgId ?? undefined, memberships, ownsActiveOrg);
}

/**
 * Validate and normalize a new member; absent optional fields are left out rather than null. Throws an `Error` named `MemberValidationError`. */
export function validateNewMember(
  input: Pick<NewMember, "email" | "password" | "role"> & Partial<Pick<NewMember, "fullName" | "supervisorId">>,
): Omit<NewMember, "fullName" | "supervisorId"> & { fullName?: string; supervisorId?: string } {
  let member: NewMember;
  try {
    member = rawValidateNewMember(
      input.email,
      input.password,
      input.fullName ?? undefined,
      input.role,
      input.supervisorId ?? undefined,
    ) as NewMember;
  } catch (thrown) {
    if (typeof thrown !== "string") throw thrown;
    const error = new Error(thrown);
    error.name = "MemberValidationError";
    throw error;
  }
  return { ...member, fullName: member.fullName ?? undefined, supervisorId: member.supervisorId ?? undefined };
}

/**
 * Pick the joiner's role and supervisor from the invite type and the lab's members.
 * Throws the validation message as a string.
 */
export function resolveOrgJoinAssignment(
  targetRole: string,
  professorIds: readonly string[],
  phdIds: readonly string[],
  professorSupervisorId?: string | null,
  phdSupervisorId?: string | null,
): JoinAssignment {
  return rawResolveOrgJoinAssignment(
    targetRole,
    professorIds,
    phdIds,
    professorSupervisorId ?? undefined,
    phdSupervisorId ?? undefined,
  ) as JoinAssignment;
}
