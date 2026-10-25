/**
 * The curve a stroke is drawn as: a cubic Hermite span between each pair of
 * stored samples. The renderer draws it and `packInkStroke` checks against it,
 * so what is kept at pack time is exactly what is drawn.
 */

/**
 * The tangent of the stroke at sample `i`, for the Hermite span on `side`.
 *
 * Uniform Catmull-Rom takes `(p[i+1] - p[i-1]) / 2` for both spans. That is
 * right when the samples are evenly spaced, and they are not once a stroke is
 * packed: the simplifier keeps a point only where the centreline bends, so a
 * straight run becomes one long span next to a short one. The same tangent on
 * both sides is then scaled to the long span and overshoots the short one — a
 * hooked spur at every corner of a box, a loop at the point of a `v`. So:
 *
 * - the **direction** is Catmull-Rom's, the sum of the two chords. Weighted by
 *   length like that, a long edge is not turned by the short chord the
 *   simplifier left at its corner. (On a circle the exact tangent is the
 *   bisector of the chords; with spans two to four times apart the weighted
 *   sum is a few degrees off it, which is under a tenth of a millimetre on
 *   the arc — the bisector's failure at a corner is a full millimetre.)
 * - the **magnitude** is the length of the span the tangent is for, so a span
 *   is bent by its own length and never by its neighbour's. On evenly spaced
 *   samples this *is* Catmull-Rom; on uneven ones the direction is shared and
 *   the curve is G1 rather than C1, which the eye cannot tell.
 * - the magnitude does **not** fade with the turn angle. A small loop written
 *   fast leaves samples 60–110° apart round its tight end, and a tangent faded
 *   there draws that end as straight chords (64° off the pen at 0.5 mm,
 *   50 mm/s). Unfaded, a corner with few points left would round off; it
 *   stays tight because `InkStrokePacker` keeps samples until the curve is
 *   within its tolerance of every one.
 *
 * At either end of the stroke the tangent is the one chord there, which makes
 * the end span a straight, evenly-parametrised run into the cap.
 */
export function inkTangentAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  side: "in" | "out" = "out",
): { x: number; y: number } {
  const count = Math.min(xs.length, ys.length);
  const x = xs[i]!;
  const y = ys[i]!;
  const hasPrev = i > 0;
  const hasNext = i + 1 < count;
  const px = hasPrev ? x - xs[i - 1]! : 0;
  const py = hasPrev ? y - ys[i - 1]! : 0;
  const nx = hasNext ? xs[i + 1]! - x : 0;
  const ny = hasNext ? ys[i + 1]! - y : 0;
  const pl = Math.hypot(px, py);
  const nl = Math.hypot(nx, ny);
  if (!(pl > 0) && !(nl > 0)) return { x: 0, y: 0 };
  if (!(pl > 0)) return { x: nx, y: ny };
  if (!(nl > 0)) return { x: px, y: py };
  const sx = px + nx;
  const sy = py + ny;
  const sl = Math.hypot(sx, sy);
  if (!(sl > 0)) return { x: 0, y: 0 };
  const magnitude = side === "out" ? nl : pl;
  return { x: (sx / sl) * magnitude, y: (sy / sl) * magnitude };
}

/**
 * A point on the stroke's curve between samples `i` and `i + 1`, at `u` in
 * [0, 1]: a cubic Hermite span through the two samples with the tangents
 * {@link inkTangentAt} gives them.
 */
export function inkCurveAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  u: number,
): { x: number; y: number } {
  const m1 = inkTangentAt(xs, ys, i, "out");
  const m2 = inkTangentAt(xs, ys, i + 1, "in");
  const uu = u * u;
  const uuu = uu * u;
  const h00 = 2 * uuu - 3 * uu + 1;
  const h10 = uuu - 2 * uu + u;
  const h01 = -2 * uuu + 3 * uu;
  const h11 = uuu - uu;
  return {
    x: h00 * xs[i]! + h10 * m1.x + h01 * xs[i + 1]! + h11 * m2.x,
    y: h00 * ys[i]! + h10 * m1.y + h01 * ys[i + 1]! + h11 * m2.y,
  };
}
