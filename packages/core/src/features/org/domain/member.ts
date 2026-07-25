/**

 * Organization domain model — pure, no I/O.

 *

 * The app has an academic hierarchy: a professor supervises PhD students, and

 * a PhD student supervises masters students. A member's `supervisorId` points at

 * the member one level up, so the whole organization is a tree rooted at

 * professors.

 *

 * Visibility follows the tree: a member may read the data of everyone in their

 * own subtree (their supervisees, transitively). Account creation follows rank:

 * you can only create members strictly below your own rank. These rules are

 * pure functions here so they can be unit-tested and reused by both the UI

 * (for affordances) and the server (for authoritative enforcement).

 */



import type { Identifiable } from "../../../shared/repository.js";



/** Academic roles, ordered by rank in {@link ROLE_RANK}. */

export type Role = "professor" | "phd" | "masters" | "standalone";



export const ROLES: readonly Role[] = ["professor", "phd", "masters"];



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

  masters: "Masters student",

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



export class MemberValidationError extends Error {

  constructor(message: string) {

    super(message);

    this.name = "MemberValidationError";

  }

}



export class MemberPermissionError extends Error {

  constructor(message: string) {

    super(message);

    this.name = "MemberPermissionError";

  }

}



/** Roles a member of the given role is allowed to create (strictly lower rank). */

export function creatableRoles(creator: Role): Role[] {

  const rank = ROLE_RANK[creator];

  return ROLES.filter((r) => ROLE_RANK[r] < rank);

}



/** Whether `creator` may provision an account with role `target`. */

export function canCreateRole(creator: Role, target: Role): boolean {

  return creatableRoles(creator).includes(target);

}



/** New members are always supervised by whoever created them. */

export function resolveSupervisorId(creator: Member, _input: NewMemberInput): string {

  return creator.id;

}



/** Validate + normalize a new-member request. Throws on invalid input. */

export function validateNewMember(input: NewMemberInput): NewMemberInput {

  const email = input.email?.trim().toLowerCase();

  if (!email) throw new MemberValidationError("Email is required.");

  if (!input.password || input.password.length < 8) {

    throw new MemberValidationError("Password must be at least 8 characters.");

  }

  if (!ROLES.includes(input.role)) {

    throw new MemberValidationError(`Unknown role: ${input.role}`);

  }

  return {

    email,

    password: input.password,

    fullName: input.fullName?.trim() || undefined,

    role: input.role,

    supervisorId: input.supervisorId?.trim() || undefined,

  };

}



/**

 * Build the id set a viewer may access: themselves plus every descendant in the

 * supervisor tree. Pure over a flat member list — mirrors recursive SQL policy.

 */

export function accessibleMemberIds(

  viewerId: string,

  members: readonly Member[],

): Set<string> {

  const childrenOf = new Map<string, Member[]>();

  for (const m of members) {

    if (!m.supervisorId) continue;

    const list = childrenOf.get(m.supervisorId) ?? [];

    list.push(m);

    childrenOf.set(m.supervisorId, list);

  }



  const ids = new Set<string>([viewerId]);

  const queue: string[] = [viewerId];

  while (queue.length > 0) {

    const current = queue.shift() as string;

    for (const child of childrenOf.get(current) ?? []) {

      if (!ids.has(child.id)) {

        ids.add(child.id);

        queue.push(child.id);

      }

    }

  }

  return ids;

}



export interface TeamVisibilityOptions {

  /** Whether the viewer belongs to at least one lab (org_memberships). */

  inLab: boolean;

  /** When set, restrict to members of the active lab. Required when inLab. */

  orgMemberIds?: ReadonlySet<string> | null;

}



/** Active-lab pool only — fails closed when inLab but org membership is unknown. */

function scopedLabPool(

  viewerId: string,

  members: readonly Member[],

  options: TeamVisibilityOptions,

): Member[] {

  if (!options.inLab) {

    const self = members.find((m) => m.id === viewerId);

    return self ? [self] : [];

  }



  if (!options.orgMemberIds || options.orgMemberIds.size === 0) {

    const self = members.find((m) => m.id === viewerId);

    return self ? [self] : [];

  }



  return members.filter((m) => options.orgMemberIds!.has(m.id));

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

  const pool = scopedLabPool(viewerId, members, options);

  if (!options.inLab) return pool;



  const allowed = accessibleMemberIds(viewerId, pool);

  const visible = pool.filter((m) => allowed.has(m.id));

  const byId = new Map<string, Member>();

  for (const m of visible) byId.set(m.id, m);

  return [...byId.values()];

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
  return scopedLabPool(viewerId, members, options);
}



/** Whether the role can supervise others (rank above masters). */

export function isSupervisorRole(role: Role | null | undefined): boolean {

  return !!role && ROLE_RANK[role] > ROLE_RANK.masters;

}



/** Role label context — standalone users are not masters/phd in the UI. */

export function resolveDisplayRole(

  role: Role,

  opts: { inLab: boolean; ownsOrg?: boolean },

): Role {

  if (opts.inLab) return role;

  if (opts.ownsOrg && role === "professor") return "professor";

  return "standalone";

}



export function memberRoleLabel(

  member: Pick<Member, "role">,

  opts: { inLab: boolean; ownsOrg?: boolean },

): string {

  return ROLE_LABELS[resolveDisplayRole(member.role, opts)];

}



/** True when profiles.role should be persisted as standalone (stale lab role). */

export function needsStandaloneRoleSync(

  profile: Pick<Member, "role" | "orgSetupComplete"> | null,

  memberships: readonly { joinSource?: string }[],

  inLab: boolean,

): boolean {

  if (!profile || profile.orgSetupComplete === false) return false;

  if (inLab || profile.role === "standalone") return false;

  const ownsOrg = memberships.some((m) => m.joinSource === "create");

  if (ownsOrg && profile.role === "professor") return false;

  return !memberships.some((m) => m.joinSource === "invite" || m.joinSource === "create");

}


