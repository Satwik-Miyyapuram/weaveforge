import { type Member, type Role } from "@weaveforge/core";
/**
 * How member rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  supervisor_id: string | null;
  org_setup_complete: boolean | null;
  active_org_id: string | null;
}

export function byName(a: Member, b: Member): number {
  return (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? "");
}

export function toDomain(r: ProfileRow): Member {
  return {
    id: r.user_id,
    email: r.email ?? undefined,
    fullName: r.full_name ?? undefined,
    role: r.role,
    supervisorId: r.supervisor_id ?? undefined,
    orgSetupComplete: r.org_setup_complete ?? false,
    activeOrgId: r.active_org_id ?? undefined,
  };
}
