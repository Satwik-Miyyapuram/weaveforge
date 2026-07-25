/**
 * Repository contract for organization members (DIP).
 *
 * Reads are auth-context dependent (they answer "who am I" and "who is on my
 * team") rather than id-keyed CRUD, so the interface is intentionally narrow —
 * account creation goes through {@link IAccountProvisioner}, not `save`.
 */

import type { Member } from "./member.js";

export interface IMemberRepository {
  /** The signed-in user's own member record, or null if none exists yet. */
  getMine(): Promise<Member | null>;
  /**
   * Every member the signed-in user is allowed to see: themselves plus all of
   * their supervisees (transitively). Enforced by row-level security server-side.
   */
  listTeam(): Promise<Member[]>;
  /**
   * Everyone in the signed-in user's lab (same top-level professor) — the pool
   * of people they can share with. A superset of {@link listTeam} (adds
   * advisors above and lab-mates across). RLS-scoped server-side.
   */
  listDirectory(): Promise<Member[]>;
  /**
   * Active-lab roster for the org chart: supervisors, peers, and supervisees.
   * A superset of {@link listTeam}; scoped to explicit lab membership.
   */
  listLab(): Promise<Member[]>;
}
