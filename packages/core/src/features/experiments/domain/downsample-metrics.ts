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
 * not it is on the grid — see {@link planSeriesIngest}. Without that a curve
 * would appear to stop at the last grid step, which for a run still in flight
 * means the dashboard lags reality by up to a stride.
 */

/** Below this step every point is kept, whatever the metric. */
export const KEEP_ALL_BELOW_STEP = 10_000;

/**
 * The sampling interval in force at `step`: 1 below the threshold, then
 * doubling once per octave beyond it.
 */
export function strideForStep(step: number): number {
  if (!Number.isFinite(step) || step < KEEP_ALL_BELOW_STEP) return 1;
  const octaves = Math.ceil(Math.log2(step / KEEP_ALL_BELOW_STEP));
  // `log2(1) === 0` at exactly the threshold, so the stride there is still 1.
  return 2 ** Math.max(0, octaves);
}

/** Whether a point at this step sits on the sampling grid. */
export function isOnSamplingGrid(step: number): boolean {
  if (!Number.isFinite(step)) return false;
  // Negative steps are not something any source produces, but flooring them to
  // "keep" is safer than a modulo whose sign is implementation-defined.
  if (step <= 0) return true;
  return step % strideForStep(step) === 0;
}

export interface DownsampleDecision<T> {
  /** Points to write. */
  keep: T[];
  /**
   * The step of a previously-stored newest point that is no longer the newest
   * and does not sit on the grid, so it should be deleted. `null` when there is
   * nothing to remove.
   */
  supersededTipStep: number | null;
}

/**
 * Decide what to store for one series, given the points arriving now and the
 * highest step already stored for it.
 *
 * `previousMaxStep` is what makes tip-keeping self-cleaning: the tip written by
 * the previous batch is only worth keeping while it is still the newest point,
 * so once this batch moves past it, it is dropped unless it is on the grid.
 * At most one such row can exist per series, so the cleanup is a single delete
 * rather than a scan.
 */
export function planSeriesIngest<T extends { step: number }>(
  points: readonly T[],
  previousMaxStep: number | null,
): DownsampleDecision<T> {
  if (points.length === 0) return { keep: [], supersededTipStep: null };

  let batchMaxStep = -Infinity;
  for (const p of points) if (p.step > batchMaxStep) batchMaxStep = p.step;

  // Keep grid points, plus the newest point in the batch. When several points
  // share the highest step (a re-send inside one batch) they all pass; the
  // upsert on `(experiment_id, metric_id, step)` collapses them.
  const keep = points.filter((p) => isOnSamplingGrid(p.step) || p.step === batchMaxStep);

  const supersededTipStep =
    previousMaxStep !== null &&
    previousMaxStep < batchMaxStep &&
    !isOnSamplingGrid(previousMaxStep)
      ? previousMaxStep
      : null;

  return { keep, supersededTipStep };
}

/**
 * Apply the same rule to an already-stored series — for the retention pass over
 * runs that predate downsampling.
 *
 * Returns the steps to delete. The newest point survives regardless, for the
 * same reason ingest keeps it: a curve that loses its endpoint reads as a run
 * that stopped early.
 */
export function stepsToPrune(storedSteps: readonly number[]): number[] {
  if (storedSteps.length === 0) return [];
  const maxStep = Math.max(...storedSteps);
  return storedSteps.filter((s) => s !== maxStep && !isOnSamplingGrid(s));
}
