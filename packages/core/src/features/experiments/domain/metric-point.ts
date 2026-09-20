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
 * Writing curves.
 *
 * In this application the Python SDK is the writer, over the ingest API, and it
 * has its own protocol on its own side of the wire. This exists so an in-memory
 * double can be filled and so the contract suite has something to seed.
 */
export interface IMetricWriter {
  append(points: MetricPoint[]): Promise<void>;
}

/** Drawing one run's curves: samples, in step order. */
export interface IMetricHistoryReader {
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
}

/**
 * The experiments list's freshness read-model: one number per experiment.
 *
 * This is not a slice of the curve reader, and saying so is the point. It
 * answers "when did this run last log?", which is an aggregate — one row per
 * experiment however much history is behind it — and while it lived on the same
 * interface as `history` it was implemented the way a row-shaped reader invites:
 * select every point of every listed run and take the first per run in the
 * browser. That is O(points ever logged) of transfer for O(experiments) of
 * information, and on a deployment whose PostgREST caps response rows it is not
 * merely slow but wrong.
 */
export interface IExperimentActivityReader {
  /** Latest sample wall-clock (epoch ms) per experiment — for stale-run detection. */
  latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>>;
}

/**
 * Everything an adapter implements, and what the contract suite checks.
 *
 * A *composition*, not a fourth interface with its own methods: consumers take
 * the narrow port they actually use — the dashboard facade takes the two
 * readers, the seeding path takes the writer — so nothing depends on a method it
 * does not call. Implementations satisfy all three because they are one class
 * over one table.
 */
export type IMetricRepository = IMetricWriter & IMetricHistoryReader & IExperimentActivityReader;
