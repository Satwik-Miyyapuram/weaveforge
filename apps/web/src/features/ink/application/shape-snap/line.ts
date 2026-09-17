import {
  LINE_BACKTRACK_LIMIT,
  LINE_ERROR_LIMIT,
  LINE_MIN_SEGMENT_COS,
  SHAPE_MIN_POINTS,
  SHAPE_MIN_SPAN,
  boundingSpan,
  confidenceOf,
  meanDeviation,
  principalAxis,
  resamplePath,
  snapBounds,
  snapPoints,
  type LineGeometry,
  type ResampleOptions,
  type ShapeFit,
  type SnapPath,
  type SnapPoint,
} from "./geometry";

/* -------------------------------------------------------------------------
 * Line
 * ---------------------------------------------------------------------- */

/**
 * Fit a line, or refuse because the mark is not one.
 *
 * Three refusals before any residual is computed, because each is a *shape* fact
 * the residual cannot express:
 *
 * 1. **Enough samples and enough span** (§6.3's "rough line" needs something to
 *    be rough about).
 * 2. **No significant back-tracking** ({@link LINE_BACKTRACK_LIMIT}) and **no
 *    sharp fold** ({@link LINE_MIN_SEGMENT_COS}). This is the arrow rule: an
 *    arrow's head retraces the shaft, so it is refused here and has to come
 *    through {@link fitArrow}, where its proportions are actually tested.
 * 3. **The samples really are collinear**, within {@link LINE_ERROR_LIMIT}.
 *
 * The fitted endpoints are the user's first and last samples, kept exactly. The
 * *direction* comes from the fit, so the interior points are projected onto the
 * fitted line: the mark straightens without the ends creeping, which is the
 * contract at the top of this module.
 */
export function fitLine(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFit<LineGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < SHAPE_MIN_POINTS) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const { cx, cy, dirX, dirY } = principalAxis(points);

  // Projection of each sample along the fitted direction, and the worst
  // *backward* step between consecutive projections. Two samples at the same
  // place project to the same number and contribute nothing.
  const projections = points.map(([x, y]) => (x - cx) * dirX + (y - cy) * dirY);
  let backtrack = 0;
  let worstCos = 1;
  for (let i = 1; i < points.length; i += 1) {
    backtrack = Math.max(backtrack, projections[i - 1]! - projections[i]!);
    const ax = points[i]![0] - points[i - 1]![0];
    const ay = points[i]![1] - points[i - 1]![1];
    const a = Math.hypot(ax, ay);
    if (a < 1e-9) continue;
    if (i + 1 >= points.length) continue;
    const bx = points[i + 1]![0] - points[i]![0];
    const by = points[i + 1]![1] - points[i]![1];
    const b = Math.hypot(bx, by);
    if (b < 1e-9) continue;
    worstCos = Math.min(worstCos, (ax * bx + ay * by) / (a * b));
  }
  if (backtrack > LINE_BACKTRACK_LIMIT * span) return null;
  if (worstCos < LINE_MIN_SEGMENT_COS) return null;

  const error =
    meanDeviation(points, (x, y) =>
      Math.abs((x - cx) * -dirY + (y - cy) * dirX),
    ) / span;
  if (error > LINE_ERROR_LIMIT) return null;

  const at = (point: SnapPoint): SnapPoint => {
    const t = (point[0] - cx) * dirX + (point[1] - cy) * dirY;
    return [Math.round(cx + dirX * t), Math.round(cy + dirY * t)];
  };
  const start = at(first);
  const end = at(last);
  return {
    shape: "line",
    error,
    confidence: confidenceOf(error, LINE_ERROR_LIMIT),
    geometry: {
      kind: "line",
      start,
      end,
      length: Math.hypot(end[0] - start[0], end[1] - start[1]),
    },
  };
}

/**
 * Mean distance from a point set to a distance function, in 0.1 mm.
 *
 * The one metric every fit reports, which is what makes the residuals
 * comparable: a rectangle's average distance to its outline can be set against
 * an ellipse's average distance to its curve, and the smaller one is the shape
 * the hand drew. A maximum would be the wrong statistic — one stray sample from
 * a pen slip would disqualify a good fit — and a sum would make the score depend
 * on how fast the user happened to write.
 */


