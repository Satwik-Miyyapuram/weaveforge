/**
 * Takes the shake out of a stroke's points without rounding its corners.
 *
 * A point where the path turns by more than CORNER_DEGREES (measured between the
 * nearest points at least CORNER_SPAN units away on either side, so a fast pen's dense
 * samples do not turn hand shake into corners) is a corner and stays exactly where it was
 * drawn, as do both ends. Every other point is averaged with its neighbours
 * (weights 1, 2, 1), SMOOTHING_PASSES times. This lets the freehand outline run
 * with a low streamline, which reaches into corners, while a shaky circle still
 * draws round.
 */

const CORNER_DEGREES = 50;
const CORNER_SPAN = 4;
const SMOOTHING_PASSES = 4;

export function smoothKeepingCorners(points: number[][]): number[][] {
  const n = points.length;
  if (n < 3) return points;
  const fixed = cornerMask(points);
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

/** True at each point where the drawn path turns sharply. */
function cornerMask(points: number[][]): boolean[] {
  const n = points.length;
  const limit = Math.cos((CORNER_DEGREES * Math.PI) / 180);
  const mask = new Array<boolean>(n).fill(false);
  const apart = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  for (let i = 1; i < n - 1; i++) {
    const q = points[i]!;
    let back = i - 1;
    while (back > 0 && apart(points[back]!, q) < CORNER_SPAN) back--;
    let ahead = i + 1;
    while (ahead < n - 1 && apart(points[ahead]!, q) < CORNER_SPAN) ahead++;
    if (apart(points[back]!, q) < CORNER_SPAN || apart(points[ahead]!, q) < CORNER_SPAN) continue;
    const p = points[back]!;
    const r = points[ahead]!;
    const ax = q[0]! - p[0]!;
    const ay = q[1]! - p[1]!;
    const bx = r[0]! - q[0]!;
    const by = r[1]! - q[1]!;
    const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (lengths > 0 && (ax * bx + ay * by) / lengths < limit) mask[i] = true;
  }
  return mask;
}
