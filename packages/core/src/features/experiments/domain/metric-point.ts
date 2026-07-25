/**
 * Step-indexed metric history — the domain type behind training curves. One
 * MetricPoint is one sample of one metric at one step, persisted in the
 * `experiment_metrics` table (migration 0016). This is what lets curves synced
 * from TensorBoard / wandb (via the Python SDK) show as full time-series in the
 * dashboard rather than only the flat summary on `Experiment.metrics`.
 */

export interface MetricPoint {
  experimentId: string;
  metric: string;
  step: number;
  value: number;
  /** ISO wall-clock time of the sample, if the source provided one. */
  wallTime?: string;
}

/**
 * Reading history is a distinct capability from managing experiment rows, so it
 * gets its own interface (ISP). The dashboard depends only on `history`; the
 * Python SDK is the writer (`append`).
 */
export interface IMetricRepository {
  append(points: MetricPoint[]): Promise<void>;
  /** All samples for an experiment (optionally one metric), step-ordered. */
  history(experimentId: string, metric?: string): Promise<MetricPoint[]>;
  /** Latest sample wall-clock (epoch ms) per experiment — for stale-run detection. */
  latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>>;
}
