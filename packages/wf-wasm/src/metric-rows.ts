/**
 * Metric row mapping (Rust `metric_rows`). The row shape stays in the web app. A driver may hand
 * back `wall_time` as a `Date`; it is normalised to an ISO string here, before the row crosses
 * into wasm, so the Rust side only ever sees a string.
 */
import { metricRowToDomain as rawMetricRowToDomain } from "../pkg/wf_wasm.js";
import type { MetricPoint } from "./bindings.js";

export type { MetricPoint } from "./bindings.js";

/** A metric row as the driver returns it: `wall_time` may be a string, a `Date`, or nothing. */
export interface MetricRowInput {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | Date | null;
}

/** A metric row as a metric point. `wallTime` is an ISO string, or absent. */
export function metricRowToDomain(row: MetricRowInput): MetricPoint {
  const wallTime = row.wall_time instanceof Date ? row.wall_time.toISOString() : row.wall_time;
  return rawMetricRowToDomain({ ...row, wall_time: wallTime ?? null }) as MetricPoint;
}
