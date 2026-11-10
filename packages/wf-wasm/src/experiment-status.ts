/**
 * Experiment status and metric display helpers (Rust `experiment_status`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/experiments/domain/experiment.ts.
 */
import {
  formatMetricCell as rawFormatMetricCell,
  isStaleRunningExperiment as rawIsStaleRunningExperiment,
  metricKeys as rawMetricKeys,
  resultsTable as rawResultsTable,
  shortSha as rawShortSha,
  statusPatchForExperiment as rawStatusPatchForExperiment,
} from "../pkg/wf_wasm.js";
import type {
  Experiment,
  ExperimentStatus,
  ExperimentStatusPatch,
  ResultsTable,
} from "./bindings.js";

export {
  experimentActivityAt,
  experimentHref,
  experimentsListHref,
  formatMetricValue,
} from "../pkg/wf_wasm.js";
export type { ResultsTable } from "./bindings.js";

/** The statuses that end a run (TS `TERMINAL_EXPERIMENT_STATUSES`). */
export const TERMINAL_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = ["done", "failed", "abandoned"];

/** Running experiments with no finish and no activity this long are treated as dead. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;

export function statusPatchForExperiment(
  experiment: Experiment,
  status: ExperimentStatus,
  now: string,
): ExperimentStatusPatch {
  const patch = rawStatusPatchForExperiment(experiment, status, now) as ExperimentStatusPatch;
  // Every key is present, so spreading the patch clears a stamp Rust left out.
  return { status: patch.status, startedAt: patch.startedAt ?? undefined, finishedAt: patch.finishedAt ?? undefined };
}

/** Short display form of a commit SHA. */
export function shortSha(sha?: string): string | undefined {
  return rawShortSha(sha);
}

export function isStaleRunningExperiment(
  experiment: Experiment,
  nowMs: number = Date.now(),
  staleMs: number = STALE_RUNNING_MS,
  lastMetricAtMs?: number,
): boolean {
  return rawIsStaleRunningExperiment(experiment, nowMs, staleMs, lastMetricAtMs);
}

/** One metric's value as text, for a chip or a table cell. */
export function formatMetricCell(_metric: string, value: unknown): string {
  // serde has no bigint; `String(bigint)` is the text the TS version produced.
  if (typeof value === "bigint") return value.toString();
  if ((typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol") {
    // Rust sees plain JSON, so JSON.stringify's own rules (toJSON, dropped undefined,
    // cycles) run here first, as they did in TS.
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      return "—";
    }
    if (json === undefined) return "—";
    const plain: unknown = JSON.parse(json);
    // A toJSON that returned a primitive: TS showed the JSON text itself.
    return typeof plain === "object" && plain !== null ? rawFormatMetricCell(_metric, plain) : json;
  }
  return rawFormatMetricCell(_metric, value);
}

/** Every metric name any of the runs logged, sorted by UTF-16 code units (Rust `metric_keys`). */
export function metricKeys(experiments: readonly Experiment[]): string[] {
  return rawMetricKeys(experiments) as string[];
}

/** Every metric name any of the runs logged, sorted by UTF-16 code units. */
export function metricKeysOf(experiments: readonly Experiment[]): string[] {
  return metricKeys(experiments);
}

export function resultsTable(experiments: readonly Experiment[]): ResultsTable {
  return rawResultsTable(experiments) as ResultsTable;
}

