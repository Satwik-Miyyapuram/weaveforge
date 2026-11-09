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

/** Signatures of the functions that moved to the Rust core (wf-wasm, crates/wf-core/src/experiments.rs). */
export interface DownsampleMetricsFns {
  /** The sampling interval in force at `step`. */
  strideForStep(step: number): number;
  /** Whether a point at this step sits on the sampling grid. */
  isOnSamplingGrid(step: number): boolean;
  /** What to store for one series, given the arriving points and the highest stored step. */
  planSeriesIngest<T extends { step: number }>(points: readonly T[], previousMaxStep: number | null): DownsampleDecision<T>;
  /** Steps to delete from an already-stored series: off-grid steps, except the newest. */
  stepsToPrune(storedSteps: readonly number[]): number[];
}