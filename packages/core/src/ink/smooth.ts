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

/**
 * Resample `points` (`x, y` pairs) to an even spacing along the path, carrying
 * `pressures` with them by linear interpolation. The first and last samples are
 * kept exactly.
 */
export function resampleInkStroke(
  points: readonly number[],
  pressures: readonly number[],
  spacing = INK_SMOOTH_SPACING,
): SmoothedInkStroke {
  const count = points.length >> 1;
  if (count < 2 || !(spacing > 0)) {
    return { points: [...points], pressures: [...pressures] };
  }
  const outPoints: number[] = [points[0]!, points[1]!];
  const outPressures: number[] = [pressures[0] ?? 0];
  let carry = 0; // distance already covered towards the next output point
  for (let i = 1; i < count; i += 1) {
    const ax = points[(i - 1) * 2]!;
    const ay = points[(i - 1) * 2 + 1]!;
    const bx = points[i * 2]!;
    const by = points[i * 2 + 1]!;
    const pa = pressures[i - 1] ?? 0;
    const pb = pressures[i] ?? pa;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    let along = spacing - carry;
    while (along <= length) {
      const u = along / length;
      outPoints.push(ax + (bx - ax) * u, ay + (by - ay) * u);
      outPressures.push(pa + (pb - pa) * u);
      along += spacing;
    }
    carry = length - (along - spacing);
  }
  // The pen's last position is the stroke's end, whatever the spacing said;
  // drop a resampled point that landed almost on it rather than doubling up.
  const lastX = points[(count - 1) * 2]!;
  const lastY = points[(count - 1) * 2 + 1]!;
  const tailX = outPoints[outPoints.length - 2]!;
  const tailY = outPoints[outPoints.length - 1]!;
  if (outPoints.length > 2 && Math.hypot(lastX - tailX, lastY - tailY) < spacing / 2) {
    outPoints.length -= 2;
    outPressures.length -= 1;
  }
  outPoints.push(lastX, lastY);
  outPressures.push(pressures[count - 1] ?? 0);
  return { points: outPoints, pressures: outPressures };
}

/**
 * The five-tap binomial kernel `[1 4 6 4 1] / 16` over the interior of `values`
 * (a flat array with `stride` numbers per sample), ends pinned. Near an end the
 * kernel is truncated and renormalised rather than reflected, so the second and
 * penultimate samples lean toward the pinned ends and the stroke keeps its
 * direction into the caps.
 */
export function binomialSmooth(
  values: readonly number[],
  stride: number,
  passes = INK_SMOOTH_PASSES,
): number[] {
  const count = values.length / stride;
  let current = [...values];
  if (count < 3) return current;
  const taps = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...current];
    for (let i = 1; i < count - 1; i += 1) {
      for (let c = 0; c < stride; c += 1) {
        let sum = 0;
        let weight = 0;
        for (let k = -2; k <= 2; k += 1) {
          const j = i + k;
          if (j < 0 || j >= count) continue;
          const w = taps[k + 2]!;
          sum += current[j * stride + c]! * w;
          weight += w;
        }
        next[i * stride + c] = sum / weight;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Resample and smooth a finished stroke: what the pen drew, without the
 * digitiser. A stroke too short to resample (a dot, a tick) is returned as is.
 */
export function smoothInkStroke(
  points: readonly number[],
  pressures: readonly number[],
  options: { spacing?: number; passes?: number } = {},
): SmoothedInkStroke {
  const resampled = resampleInkStroke(points, pressures, options.spacing);
  if (resampled.points.length < 6) return resampled;
  return {
    points: binomialSmooth(resampled.points, 2, options.passes),
    pressures: binomialSmooth(resampled.pressures, 1, options.passes),
  };
}
