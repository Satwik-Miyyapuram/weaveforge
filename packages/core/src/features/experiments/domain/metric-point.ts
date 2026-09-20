/**
 * Step-indexed metric history — the domain type behind training curves. One
 * MetricPoint is one sample of one metric at one step, read from the
 * `experiment_metrics` view: loose rows in `experiment_metric_points`, plus
 * settled points packed into arrays in `experiment_metric_chunks` (0114/0115).
 * This is what lets curves synced from TensorBoard / wandb (via the Python SDK)
 * show as full time-series in the dashboard rather than only the flat summary on
 * `Experiment.metrics`.
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
  /**
   * Samples for an experiment (optionally one metric), step-ordered.
   *
   * `maxPoints` is a budget for the whole result, and it exists because a chart
   * is a few hundred pixels wide: a long run stores tens of thousands of points
   * per metric, and every one of them would otherwise be transferred, parsed and
   * laid out to draw a line. Below the budget nothing is reduced. Above it the
   * reduction is a stride — never an average, which would smooth away the spikes
   * a spike is the reason to plot — and the first and last sample of each metric
   * always survive, so a curve never appears to start late or stop early.
   */
  history(
    experimentId: string,
    metric?: string,
    options?: { maxPoints?: number },
  ): Promise<MetricPoint[]>;
  /** Latest sample wall-clock (epoch ms) per experiment — for stale-run detection. */
  latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>>;
}
