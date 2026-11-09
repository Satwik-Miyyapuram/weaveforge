/**
 * Lab member and org rules (Rust `member` and `org`), re-exported from index.ts. Keeps
 * the signatures of the functions in packages/core/src/features/org/domain/ and
 * apps/web/src/features/org/application/ that they replace. Functions that return
 * members return them from the input array (the Rust side returns indices).
 */
import {
  canCreateRole as rawCanCreateRole,
  creatableRoles as rawCreatableRoles,
  formatInviteCode as rawFormatInviteCode,
  normalizeOrgInviteCode as rawNormalizeOrgInviteCode,
  resolveOrgJoinAssignment as rawResolveOrgJoinAssignment,
  resolveSupervisorId as rawResolveSupervisorId,
  validateNewMember as rawValidateNewMember,
  validateOrgName as rawValidateOrgName,
  filterLabMembers as rawFilterLabMembers,
  filterTeamMembers as rawFilterTeamMembers,
  hasActiveLab as rawHasActiveLab,
  isExplicitLabMembership as rawIsExplicitLabMembership,
  isSupervisorRole as rawIsSupervisorRole,
  needsOrgSetup as rawNeedsOrgSetup,
  needsStandaloneRoleSync as rawNeedsStandaloneRoleSync,
  resolveDisplayRole as rawResolveDisplayRole,
  shouldSyncStandalone as rawShouldSyncStandalone,
  studentsOf as rawStudentsOf,
} from "../pkg/wf_wasm.js";

import type { JoinAssignment, MemberLink, Membership, NewMember, OrgSetupState, ProfileState } from "./bindings.js";

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

/** Roles `creator` may create accounts for, in invite-code order. */
export function creatableRoles(creator: string): string[] {
  return rawCreatableRoles(creator) as string[];
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

/** Whether `profiles.role` should be saved as standalone (the stored lab role is stale). */
export function needsStandaloneRoleSync(
  profile: ProfileState | null,
  memberships: readonly Membership[],
  inLab: boolean,
): boolean {
  return rawNeedsStandaloneRoleSync(profile, memberships, inLab);
}

/** Whether the user created or joined the lab (not a migration backfill). */
export function isExplicitLabMembership(membership: Membership): boolean {
  return rawIsExplicitLabMembership(membership);
}

/** Whether the active lab is set and the user is explicitly in it, or owns it. */
export function hasActiveLab(
  activeOrgId: string | null | undefined,
  memberships: readonly Membership[],
  ownsActiveOrg = false,
): boolean {
  return rawHasActiveLab(activeOrgId ?? undefined, memberships, ownsActiveOrg);
}

/** Whether the standalone role sync may run. `labs` is null when memberships are unknown. */
export function shouldSyncStandalone(
  profile: ProfileState | null,
  labs: readonly Membership[] | null,
): boolean {
  return rawShouldSyncStandalone(profile, labs);
}

/** Whether the first-run setup screen applies. */
export function needsOrgSetup(state: OrgSetupState): boolean {
  return rawNeedsOrgSetup(state);
}

/** Whether `creator` may create an account with role `target`. */
export function canCreateRole(creator: string, target: string): boolean {
  return rawCanCreateRole(creator, target);
}

/** Supervisor recorded for an account `creatorId` creates: the creator. */
export function resolveSupervisorId(creatorId: string): string {
  return rawResolveSupervisorId(creatorId);
}

/** Validate and normalize a new member. Throws the validation message as a string. */
export function validateNewMember(
  input: Pick<NewMember, "email" | "password" | "role"> & Partial<Pick<NewMember, "fullName" | "supervisorId">>,
): NewMember {
  return rawValidateNewMember(
    input.email,
    input.password,
    input.fullName ?? undefined,
    input.role,
    input.supervisorId ?? undefined,
  ) as NewMember;
}

/** Group an invite code as `XXX-XXX-XXX`. */
export function formatInviteCode(raw: string): string {
  return rawFormatInviteCode(raw);
}

/** Normalize typed invite input to its canonical code characters. */
export function normalizeOrgInviteCode(input: string): string {
  return rawNormalizeOrgInviteCode(input);
}

/** Trim and check a lab name. Throws the validation message as a string. */
export function validateOrgName(name: string): string {
  return rawValidateOrgName(name);
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
