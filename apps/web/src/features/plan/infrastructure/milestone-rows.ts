import type {
  ComputeNeed,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
} from "@weaveforge/core";

/**
 * How a milestone is stored, and how it maps to and from the domain type.
 *
 * Shared by both backend providers. The Supabase and Postgres repositories talk
 * to the *same* table — one through supabase-js, the other through `pg` — so
 * the column shape and the mapping are not per-provider facts, and holding two
 * copies of them meant they drifted: one side had `?? []` fallbacks for fields
 * the domain type marks required, the other did not. Nothing behavioural, but
 * the next divergence would not have been.
 *
 * What stays with a provider is the SQL or the query builder, and nothing else.
 */
export interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  target_date: string | null;
  dependencies: MilestoneDependency[] | null;
  compute: ComputeNeed[] | null;
  created_at: string;
}

export function milestoneToDomain(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status,
    targetDate: r.target_date ?? undefined,
    dependencies: r.dependencies ?? [],
    compute: r.compute ?? [],
    createdAt: r.created_at,
  };
}

export function milestoneToRow(m: Milestone): Record<string, unknown> {
  return {
    id: m.id,
    title: m.title,
    description: m.description ?? null,
    status: m.status,
    target_date: m.targetDate ?? null,
    dependencies: m.dependencies,
    compute: m.compute,
    created_at: m.createdAt,
  };
}
