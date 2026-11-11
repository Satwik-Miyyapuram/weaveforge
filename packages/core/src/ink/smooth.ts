/** Types for smooth. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * Stroke smoothing at commit: the pass that makes a stroke look drawn.
 *
 * The live filter (1-Euro) is causal, so it can only trade lag for smoothness
 * and leaves what a digitiser adds at 120 Hz: a sample every 0.3–1 mm whose
 * spacing and lateral position both jitter by a fraction of a unit. A curve
 * through those samples wobbles at the sample rate, which is the "not smooth"
 * a reader sees next to OneNote's ink, and it is not lag OneNote is spending to
 * avoid it — its stroke is *refitted* once the pen lifts.
 *
 * This is that refit, done the cheap way: the stroke is resampled to an even
 * spacing along its length, and the resampled points are run through a
 * binomial kernel with the ends pinned. The kernel is non-causal, so there is
 * no lag to pay, and at the spacing used it moves a point by less than the
 * width of the nib while removing the sample-rate wobble entirely. Corners
 * survive because the kernel is only two samples wide: a sharp turn rounds by
 * under half a millimetre, which is what a real pen does.
 */

/** Spacing the stroke is resampled to before smoothing, in 0.1 mm. */
export const INK_SMOOTH_SPACING = 3;

/** Smoothing passes of the five-tap binomial kernel. */
export const INK_SMOOTH_PASSES = 2;

export interface SmoothedInkStroke {
  points: number[];
  pressures: number[];
}

