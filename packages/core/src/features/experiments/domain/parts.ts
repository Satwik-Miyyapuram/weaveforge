import type { IReadableRepository, IWritableRepository } from "../../../shared/parts.js";
import type { Experiment, ExperimentFilter } from "./experiment.js";

// --- downsample-metrics ---
/**
 * Fix C of docs/internal/future-work/metrics-storage-plan.md — bound a series' point
 * count instead of only making each point smaller.
 *
 * Fixes A and B are constant factors: they make a point cheaper, but a run that
 * logs forever still fills the disk, just later. `experiment_metrics` is the
 * only table in the schema that grows without bound, so it alone decides when
 * the 50 GB `pgdata` volume runs out. This is the part that changes the shape
 * of the problem rather than its slope.
 *
 * ## The rule
 *
 * Every point is kept below {@link KEEP_ALL_BELOW_STEP}. Past that the sample
 * rate halves once per octave of step number: one point in 2 up to 20k, one in
 * 4 up to 40k, one in 8 up to 80k, and so on.
 *
 * That makes the stored size *logarithmic* in run length. Each octave
 * contributes the same ~5k points however far out it is:
 *
 * | run length | points stored |
 * |---|---|
 * | 10k   | 10,000 |
 * | 100k  | ~25,000 |
 * | 400k  | ~40,000 |
 * | 4M    | ~55,000 |
 *
 * A fixed "one in N" would have been simpler, but it only divides unbounded
 * growth by N — a long enough run still fills the volume. Halving per octave
 * means no run of any plausible length does.
 *
 * ## Why the decision is a function of `step` alone
 *
 * It could have been "count what is already stored, then thin" — but that makes
 * the outcome depend on batch boundaries and arrival order, so the same run
 * logged twice would store different points, and a retry would disagree with
 * the original. Keying purely on `step` makes it deterministic and idempotent:
 * a given step is either kept or not, whoever asks and whenever. The retention
 * pass can then apply exactly the same predicate to already-stored rows and
 * agree with what ingest would have done.
 *
 * The one exception is the newest point of a series, which is kept whether or
 * not it is on the grid (Rust `plan_series_ingest`). Without that a curve
 * would appear to stop at the last grid step, which for a run still in flight
 * means the dashboard lags reality by up to a stride.
 */
/** Below this step every point is kept, whatever the metric. */
export const KEEP_ALL_BELOW_STEP = 10_000;

export interface DownsampleDecision<T> {
  /** Points to write. */
  keep: T[];
  /** Step of a stored newest point that is now superseded and off the grid, or null. */
  supersededTipStep: number | null;
}

// --- experiment-repository ---
/** Repository contract for experiments (DIP). */
/**
 * Fields an edit changes. A key present with `undefined` clears that field;
 * an absent key is left as stored.
 */
export type ExperimentPatch = Partial<Omit<Experiment, "id" | "createdAt">>;

export interface IExperimentRepository
  extends IReadableRepository<Experiment, ExperimentFilter>,
    IWritableRepository<Experiment> {
  /**
   * Write only `fields` of an existing run. Edits go through here rather than
   * `save`, so two edits in flight together cannot undo each other's field.
   */
  patch(id: string, fields: ExperimentPatch): Promise<void>;
}

// --- metric-point ---
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

/**
 * How many points a reader can use.
 *
 * The budget is a required argument rather than an optional one because the
 * signature is the only place this decision can be made once. Optional, the
 * cheap path was the one a caller had to remember to ask for, and `history(id)`
 * read as "sometimes this is fine" when the truth is "it is fine exactly when
 * you say how many points you can draw".
 */
export interface MetricBudget {
  /**
   * Ceiling for the result, applied **per metric** — a chart overlays several
   * series and each needs its own resolution, so one budget across them would
   * starve whichever sorts second.
   */
  readonly maxPoints: number;
}

/** Drawing one run's curves: samples, in step order. */
export interface IMetricHistoryReader {
  /**
   * Samples for an experiment (optionally one metric), step-ordered.
   *
   * `budget` exists because a chart is a few hundred pixels wide: a long run
   * stores tens of thousands of points per metric, and every one of them would
   * otherwise be transferred, parsed and laid out to draw a line. Below the
   * budget nothing is reduced. Above it the reduction is a stride — never an
   * average, which would smooth away the spikes a spike is the reason to plot —
   * and the first and last sample of each metric always survive, so a curve
   * never appears to start late or stop early.
   *
   * There is deliberately no unbudgeted variant. The adapter used to fall back
   * to materialising the entire series when the budget was omitted, which is a
   * read port returning an unbounded value on a path a caller could reach by
   * forgetting a keyword argument. A genuinely complete read — an export, a
   * recompute — belongs behind its own method name with its own documented cost,
   * not behind the cheap one.
   */
  history(experimentId: string, metric: string | undefined, budget: MetricBudget): Promise<MetricPoint[]>;
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
