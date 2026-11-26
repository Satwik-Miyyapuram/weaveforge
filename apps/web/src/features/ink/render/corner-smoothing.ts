/**
 * Takes the shake out of a stroke's points without rounding its corners.
 *
 * A point where the path turns by more than CORNER_DEGREES (measured over
 * CORNER_SPAN points either side) is a corner and stays exactly where it was
 * drawn, as do both ends. Every other point is averaged with its neighbours
 * (weights 1, 2, 1), SMOOTHING_PASSES times. This lets the freehand outline run
 * with a low streamline, which reaches into corners, while a shaky circle still
 * draws round. `pinned` marks more points that stay put: the corners a sparse
 * stroke had before it was filled in (hermite-densify.ts), which a span of
 * CORNER_SPAN filled points is too short to see.
 */

export const CORNER_DEGREES = 50;
const CORNER_SPAN = 2;
const SMOOTHING_PASSES = 4;

export function smoothKeepingCorners(points: number[][], pinned?: readonly boolean[]): number[][] {
  const n = points.length;
  if (n < 3) return points;
  const fixed = cornerMask(points);
  pinned?.forEach((pin, i) => {
    if (pin) fixed[i] = true;
  });
  let current = points;
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    const next = current.slice();
    for (let i = 1; i < n - 1; i++) {
      if (fixed[i]) continue;
      const a = current[i - 1]!;
      const b = current[i]!;
      const c = current[i + 1]!;
      next[i] = [(a[0]! + 2 * b[0]! + c[0]!) / 4, (a[1]! + 2 * b[1]! + c[1]!) / 4];
    }
    current = next;
  }
  return current;
}

/** The turn, in degrees, from p→q to q→r; 0 when either is empty. */
export function turnDegrees(p: readonly number[], q: readonly number[], r: readonly number[]): number {
  const ax = q[0]! - p[0]!;
  const ay = q[1]! - p[1]!;
  const bx = r[0]! - q[0]!;
  const by = r[1]! - q[1]!;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!(lengths > 0)) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / lengths))) * 180) / Math.PI;
}

/** True at each point where the drawn path turns sharply. */
function cornerMask(points: number[][]): boolean[] {
  const n = points.length;
  const mask = new Array<boolean>(n).fill(false);
  for (let i = CORNER_SPAN; i < n - CORNER_SPAN; i++) {
    if (turnDegrees(points[i - CORNER_SPAN]!, points[i]!, points[i + CORNER_SPAN]!) > CORNER_DEGREES) mask[i] = true;
  }
  return mask;
}
