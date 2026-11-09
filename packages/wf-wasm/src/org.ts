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

/** A role a member can hold in the lab tree. */
export type OrgMemberRole = "professor" | "phd" | "masters" | "standalone";

/** A lab member as the visibility rules read them. Other fields are ignored. */
export interface MemberLinkInput {
  id: string;
  supervisorId?: string | null;
}

/** What a viewer may see of a lab. `orgMemberIds` is the active lab's roster, if known. */
export interface TeamVisibilityInput {
  inLab: boolean;
  orgMemberIds?: ReadonlySet<string> | null;
}

/** An org membership as the lab rules read it. */
export interface OrgMembershipInput {
  orgId?: string;
  joinSource?: string | null;
}

/** A profile as the setup and role-sync rules read it. */
export interface OrgProfileInput {
  role: string;
  orgSetupComplete?: boolean | null;
  activeOrgId?: string | null;
}

/** The first-run setup state the setup gate reads. */
export interface OrgSetupStateInput {
  hasOrgs: boolean;
  loading: boolean;
  profile: OrgProfileInput | null;
  error?: string | null;
}

function wireVisibility(options: TeamVisibilityInput) {
  return {
    inLab: options.inLab,
    orgMemberIds: options.orgMemberIds ? [...options.orgMemberIds] : null,
  };
}

function pick<T>(items: readonly T[], indices: readonly number[]): T[] {
  return indices.map((i) => items[i] as T);
}

/** Roles `creator` may create accounts for, in invite-code order. */
export function creatableRoles(creator: OrgMemberRole): Exclude<OrgMemberRole, "standalone">[] {
  return rawCreatableRoles(creator) as Exclude<OrgMemberRole, "standalone">[];
}

/** The supervision team: the viewer plus all supervisees, at any depth. */
export function filterTeamMembers<T extends MemberLinkInput>(
  viewerId: string,
  members: readonly T[],
  options: TeamVisibilityInput,
): T[] {
  return pick(members, rawFilterTeamMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The full active-lab roster, for the org chart. */
export function filterLabMembers<T extends MemberLinkInput>(
  viewerId: string,
  members: readonly T[],
  options: TeamVisibilityInput,
): T[] {
  return pick(members, rawFilterLabMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The people below `viewerId` in the supervisor tree, at any depth. */
export function studentsOf<T extends MemberLinkInput>(viewerId: string | undefined, team: readonly T[]): T[] {
  return pick(team, rawStudentsOf(viewerId ?? undefined, team) as number[]);
}

/** Whether a role can supervise others (rank above masters). */
export function isSupervisorRole(role: string | null | undefined): boolean {
  return rawIsSupervisorRole(role ?? undefined);
}

/** Role shown for a member: standalone outside a lab, except an owner's professor. */
export function resolveDisplayRole(
  role: OrgMemberRole,
  opts: { inLab: boolean; ownsOrg?: boolean },
): OrgMemberRole {
  return rawResolveDisplayRole(role, opts.inLab, opts.ownsOrg ?? false) as OrgMemberRole;
}

/** Whether `profiles.role` should be saved as standalone (the stored lab role is stale). */
export function needsStandaloneRoleSync(
  profile: OrgProfileInput | null,
  memberships: readonly OrgMembershipInput[],
  inLab: boolean,
): boolean {
  return rawNeedsStandaloneRoleSync(profile, memberships, inLab);
}

/** Whether the user created or joined the lab (not a migration backfill). */
export function isExplicitLabMembership(membership: OrgMembershipInput): boolean {
  return rawIsExplicitLabMembership(membership);
}

/** Whether the active lab is set and the user is explicitly in it, or owns it. */
export function hasActiveLab(
  activeOrgId: string | null | undefined,
  memberships: readonly OrgMembershipInput[],
  ownsActiveOrg = false,
): boolean {
  return rawHasActiveLab(activeOrgId ?? undefined, memberships, ownsActiveOrg);
}

/** Whether the standalone role sync may run. `labs` is null when memberships are unknown. */
export function shouldSyncStandalone(
  profile: OrgProfileInput | null,
  labs: readonly OrgMembershipInput[] | null,
): boolean {
  return rawShouldSyncStandalone(profile, labs);
}

/** Whether the first-run setup screen applies. */
export function needsOrgSetup(state: OrgSetupStateInput): boolean {
  return rawNeedsOrgSetup(state);
}

/** Input for creating a lab member account. */
export interface NewMemberInput {
  email: string;
  password: string;
  fullName?: string | null;
  role: string;
  supervisorId?: string | null;
}

/** A validated account request. Email is lowercased; password is as entered. */
export interface NewMember {
  email: string;
  password: string;
  fullName: string | null;
  role: string;
  supervisorId: string | null;
}

/** The role and supervisor a joiner gets from an invite. */
export interface JoinAssignment {
  role: OrgMemberRole;
  supervisorId: string | null;
}

/** Whether `creator` may create an account with role `target`. */
export function canCreateRole(creator: OrgMemberRole, target: OrgMemberRole): boolean {
  return rawCanCreateRole(creator, target);
}

/** Supervisor recorded for an account `creatorId` creates: the creator. */
export function resolveSupervisorId(creatorId: string): string {
  return rawResolveSupervisorId(creatorId);
}

/** Validate and normalize a new member. Throws the validation message as a string. */
export function validateNewMember(input: NewMemberInput): NewMember {
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
