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
  /**
   * `timestamptz` as PostgREST returns it — **not** always a string.
   *
   * `supabase-js` hands back an ISO string, and the local PostgREST-shaped client
   * hands back a `Date`, because that is what the driver produced. Typing this
   * `string | null` made the difference invisible: the field is declared
   * `wallTime?: string` on `MetricPoint`, nothing narrowed it, and a `Date`
   * therefore travelled out of the adapter as a `Date` — through a type that
   * promises a string. `toDomain` normalises it, which is why this is
   * `string | Date | null` rather than the lie the previous type told.
   */
  wall_time: string | Date | null;
}

export function toDomain(r: MetricRow): MetricPoint {
  return {
    experimentId: r.experiment_id,
    metric: r.metric,
    step: r.step,
    value: r.value,
    wallTime: toIsoString(r.wall_time),
  };
}

/** A `timestamptz` column as the ISO string `MetricPoint` declares, or nothing. */
function toIsoString(value: string | Date | null): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}
