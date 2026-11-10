import type {
  ComputeNeed,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
} from "@weaveforge/core";
import { requireRowSpec } from "@/backend/providers/postgrest/spec-repository";
import { readyCore } from "@/lib/rust-core";

/**
 * How a milestone is stored, and how it maps to and from the domain type.
 *
 * Shared by both backend providers. The PostgREST and Postgres repositories talk
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

/**
 * The columns a MilestoneRow is read as, named rather than starred. Rust's postgrest spec
 * names them, next to the table and order the repository uses.
 */
export function milestoneColumns(): string {
  return requireRowSpec("milestones").columns;
}

/**
 * The wasm mapper returns the bindings Milestone, whose optional fields are
 * typed `?: T | null` (serde emits null). The domain type wants `?: T`, so
 * each nullable field is mapped `?? undefined`.
 */
export function milestoneToDomain(r: MilestoneRow): Milestone {
  const m = readyCore().milestoneFromRow(r);
  return {
    id: m.id,
    title: m.title,
    description: m.description ?? undefined,
    status: m.status,
    targetDate: m.targetDate ?? undefined,
    dependencies: m.dependencies.map(withoutNulls),
    compute: m.compute.map(withoutNulls),
    createdAt: m.createdAt,
  };
}

/** The object with its null fields left out, as the stored JSON had them absent. */
function withoutNulls<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as { [K in keyof T]: Exclude<T[K], null> };
}
