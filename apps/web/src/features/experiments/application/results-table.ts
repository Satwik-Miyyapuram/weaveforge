import { type Experiment } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** Every metric name any of the runs logged, sorted. */
export function metricKeysOf(experiments: readonly Experiment[]): string[] {
  const keys = new Set<string>();
  for (const e of experiments) for (const k of Object.keys(e.metrics ?? {})) keys.add(k);
  return [...keys].sort();
}

/** Runs × metrics as display text: a Run column, then one column per metric. */
export interface ResultsTable {
  header: string[];
  rows: string[][];
}

export function resultsTable(experiments: readonly Experiment[]): ResultsTable {
  const keys = metricKeysOf(experiments);
  return {
    header: ["Run", ...keys],
    rows: experiments.map((e) => [e.name, ...keys.map((k) => typedCore().formatMetricCell(k, e.metrics?.[k]))]),
  };
}
