/**
 * The lasso: which strokes a loop drawn round them has caught.
 *
 * The sheet's lasso is a polygon the hand draws, and the worker decides what is
 * inside it. A PDF page has the same gesture, so the rule lives here rather
 * than in the worker: one definition of "caught", callable from either surface
 * and testable without a canvas or a document.
 *
 * OneNote's rule is the one implemented: a stroke is caught when **most of its
 * points** are inside the loop, not when any part of it touches. A loop drawn
 * round a sentence must take the sentence, not every stroke whose tail happens
 * to cross the loop on its way somewhere else.
 */

/** The share of a stroke's points a loop must hold for it to be caught. */
export const LASSO_CAUGHT_SHARE = 0.6;

/**
 * Whether a point is inside a closed polygon, by the even-odd rule.
 *
 * `polygon` is flat `x, y` pairs, open or closed (the closing edge is implied),
 * which is how both surfaces carry a drawn path. The half-open `>`/`>=` pair is
 * what stops a point exactly level with a vertex being counted twice.
 */
export function pointInPolygon(
  polygon: readonly number[],
  x: number,
  y: number,
): boolean {
  const count = Math.floor(polygon.length / 2);
  if (count < 3) return false;
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = polygon[i * 2]!;
    const yi = polygon[i * 2 + 1]!;
    const xj = polygon[j * 2]!;
    const yj = polygon[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a loop has caught a stroke: at least `share` of its points inside.
 *
 * Counted over the stroke's stored points rather than its length: the samples
 * are dense enough that the two agree, and this needs no geometry.
 */
export function inkPathsInPolygon(
  paths: readonly (readonly number[])[],
  polygon: readonly number[],
  share = LASSO_CAUGHT_SHARE,
): boolean {
  let points = 0;
  let caught = 0;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i += 2) {
      const x = path[i]!;
      const y = path[i + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points += 1;
      if (pointInPolygon(polygon, x, y)) caught += 1;
    }
  }
  return points > 0 && caught / points >= share;
}
