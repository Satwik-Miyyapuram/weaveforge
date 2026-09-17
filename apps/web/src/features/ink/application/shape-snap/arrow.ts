import {
  ARROW_MAX_HEAD_RATIO,
  ARROW_MAX_OPENING_DEGREES,
  ARROW_MIN_HEAD_REACH,
  ARROW_MIN_OPENING_DEGREES,
  ARROW_MIN_PATH_RATIO,
  ARROW_SHAFT_ERROR_LIMIT,
  SHAPE_MIN_POINTS,
  SHAPE_MIN_SPAN,
  boundingSpan,
  confidenceOf,
  meanDeviation,
  pathLength,
  principalAxis,
  resamplePath,
  snapBounds,
  snapPoints,
  type ArrowGeometry,
  type ResampleOptions,
  type ShapeFit,
  type SnapPath,
  type SnapPoint,
} from "./geometry";

/* -------------------------------------------------------------------------
 * Arrow
 * ---------------------------------------------------------------------- */

/**
 * Fit an arrow — a long shaft and a short head — or refuse.
 *
 * The tip is the last point the pen reached on its way *out*: the last local
 * maximum of the distance from where it went down. That is the honest reading of
 * "an arrow" — the pen travels away from its start and comes back only to form
 * the barbs — and it is deliberately not "the sample furthest from the start",
 * which a retraced head contradicts: a hand that draws the first barb, the tip,
 * the second barb and then returns to the tip along the shaft leaves its final
 * sample on the tip, so the farthest sample and the turning point are different
 * indices. (The tip's *endpoint* also has to be the outermost sample of the head;
 * that, not the index, is what "the barbs lie behind it" means.)
 *
 * Everything after that turning point is the head, and the three tests are the
 * three things that make a "head" a head rather than a wobble:
 *
 * 1. **The head is long enough to see** ({@link ARROW_MIN_HEAD_REACH}) — a flick
 *    at the end of a line is a line.
 * 2. **The pen travelled further than the distance it covered**
 *    ({@link ARROW_MIN_PATH_RATIO}) — a straight stroke's path *is* its span, and
 *    an arrow's is span plus its barbs, which is the cheapest possible test that
 *    something doubled back. It is also the rectangle's mirror: a rectangle is
 *    2× its diagonal, an arrow barely over 1×.
 * 3. **Two barbs open into a V** ({@link ARROW_MIN_OPENING_DEGREES} to
 *    {@link ARROW_MAX_OPENING_DEGREES}), none of them past the tip
 *    ({@link ARROW_MAX_HEAD_RATIO}), and the shaft behind them straight enough
 *    ({@link ARROW_SHAFT_ERROR_LIMIT}) that it is a shaft and not a second bend.
 *
 * The returned geometry keeps the shaft and the head as *separate* paths. That
 * is not cosmetic: the samples retrace the last stretch of shaft to reach the
 * second barb, and drawing one polyline through them would paint that stretch
 * twice and leave a bead at the fold (§6.2.3's stencil dedupe is for
 * highlighter, not for a pen).
 */
export function fitArrow(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFit<ArrowGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < 4) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  // The tip is the sample the pen travelled furthest to reach *before* it turned
  // back: the last local maximum of the distance from where the pen went down.
  // It is not simply the farthest sample. A hand drawing an arrow works back
  // along the shaft to draw the second barb, and a *retraced* head — the common
  // case, where the pen returns to the tip along the shaft — has its final sample
  // sitting on the tip again, so "farthest" and "tip" disagree by an index.
  const start = points[0]!;
  const reach = points.map(([x, y]) => Math.hypot(x - start[0], y - start[1]));
  let tipIndex = -1;
  for (let i = 1; i + 1 < points.length; i += 1) {
    if (reach[i]! > reach[i - 1]! && reach[i]! >= reach[i + 1]!) tipIndex = i;
  }
  // eslint-disable-next-line no-console
  if (tipIndex < 0) return null;
  const farthest = reach[tipIndex]!;
  // The shaft has to be a shaft and the head has to be a head: at least two
  // samples before the tip to give it a direction, and at least two after it for
  // the barbs. A head of exactly two samples is therefore accepted, which is the
  // minimum a real arrow can have.
  if (tipIndex < 2 || tipIndex > points.length - 3) {
    return null;
  }
  if (farthest < ARROW_MIN_HEAD_REACH * span) {
    return null;
  }

  // Every head sample must lie *behind* the tip: a barb is a step back toward
  // where the pen started, never further out than the point it springs from.
  // That is what makes this an arrow and not a mark that simply wanders.
  const tip = points[tipIndex]!;
  const head = points.slice(tipIndex + 1);
  const headReach = Math.max(
    ...head.map(([x, y]) => Math.hypot(x - start[0], y - start[1])),
  );
  if (headReach > farthest * ARROW_MAX_HEAD_RATIO) {
    return null;
  }
  if (pathLength(points) < ARROW_MIN_PATH_RATIO * farthest) {
    return null;
  }

  // The shaft is everything up to the tip, plus the tip itself: a fitted line
  // through those samples, exactly as `fitLine` would, but with the back-tracking
  // rule deliberately absent — the back-tracking *is* the arrow.
  const shaft = points.slice(0, tipIndex + 1);
  const { cx, cy, dirX, dirY } = principalAxis(shaft);
  const shaftError =
    meanDeviation(shaft, (x, y) =>
      Math.abs((x - cx) * -dirY + (y - cy) * dirX),
    ) / farthest;
  if (shaftError > ARROW_SHAFT_ERROR_LIMIT) return null;

  // eslint-disable-next-line no-console
  const project = (x: number, y: number): SnapPoint => {
    const t = (x - cx) * dirX + (y - cy) * dirY;
    return [Math.round(cx + dirX * t), Math.round(cy + dirY * t)];
  };
  const base = project(start[0], start[1]);
  const shaftTip = project(tip[0], tip[1]);

  // The barbs' vertices: the two head samples that swing widest off the shaft,
  // which is where a hand-drawn head's points are even when the two strokes
  // differ in length. Ordering them by the cross product puts them in the order
  // the pen met them, so the head path is replayable.
  const toTipX = tip[0] - base[0];
  const toTipY = tip[1] - base[1];
  const toTipLength = Math.hypot(toTipX, toTipY);
  if (toTipLength <= 0) return null;
  const nx = -toTipY / toTipLength;
  const ny = toTipX / toTipLength;
  let widest = -1;
  let widestOffset = 0;
  let second = -1;
  let secondOffset = 0;
  for (let i = 0; i < head.length; i += 1) {
    const offset = (head[i]![0] - base[0]) * nx + (head[i]![1] - base[1]) * ny;
    const magnitude = Math.abs(offset);
    if (magnitude > widestOffset) {
      second = widest;
      secondOffset = widestOffset;
      widest = i;
      widestOffset = magnitude;
    } else if (magnitude > secondOffset) {
      second = i;
      secondOffset = magnitude;
    }
  }
  if (widest < 0 || second < 0) return null;
  const firstBarb = head[Math.min(widest, second)]!;
  const secondBarb = head[Math.max(widest, second)]!;

  const opening = openingDegrees(tip, firstBarb, secondBarb);
  // eslint-disable-next-line no-console
  if (
    opening < ARROW_MIN_OPENING_DEGREES ||
    opening > ARROW_MAX_OPENING_DEGREES
  )
    return null;

  return {
    shape: "arrow",
    error: shaftError,
    confidence: confidenceOf(shaftError, ARROW_SHAFT_ERROR_LIMIT),
    geometry: {
      kind: "arrow",
      start: base,
      tip: shaftTip,
      head: [firstBarb, secondBarb],
      shaftPath: [base, shaftTip],
      headPath: [shaftTip, firstBarb, shaftTip, secondBarb],
    },
  };
}

/** The angle a tip's two barbs open through, in degrees. `0` when either is degenerate. */
function openingDegrees(tip: SnapPoint, a: SnapPoint, b: SnapPoint): number {
  const ax = a[0] - tip[0];
  const ay = a[1] - tip[1];
  const bx = b[0] - tip[0];
  const by = b[1] - tip[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la <= 0 || lb <= 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cosine) * 180) / Math.PI;
}



