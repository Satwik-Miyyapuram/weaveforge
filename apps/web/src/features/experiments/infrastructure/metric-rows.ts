import type {
  MetricPoint,
} from "@weaveforge/core";

/**
 * How metric rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface MetricRow {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | null;
}

export function toDomain(r: MetricRow): MetricPoint {
  return {
    experimentId: r.experiment_id,
    metric: r.metric,
    step: r.step,
    value: r.value,
    wallTime: r.wall_time ?? undefined,
  };
}
