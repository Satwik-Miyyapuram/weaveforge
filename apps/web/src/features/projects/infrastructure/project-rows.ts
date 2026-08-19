import type {
  Project,
} from "@weaveforge/core";

/**
 * How project rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export function toDomain(r: ProjectRow): Project {
  return { id: r.id, name: r.name, color: r.color ?? undefined, createdAt: r.created_at };
}
