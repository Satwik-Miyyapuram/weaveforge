/** Types for ink-lasso. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface InkLassoFns {
  /**
 * Whether a point is inside a closed polygon, by the even-odd rule.
 *
 * `polygon` is flat `x, y` pairs, open or closed (the closing edge is implied),
 * which is how both surfaces carry a drawn path. The half-open `>`/`>=` pair is
 * what stops a point exactly level with a vertex being counted twice.
 */
  pointInPolygon(polygon: readonly number[], x: number, y: number): boolean;
  /**
 * Whether a loop has caught a stroke: at least `share` of its points inside.
 *
 * Counted over the stroke's stored points rather than its length: the samples
 * are dense enough that the two agree, and this needs no geometry.
 */
  inkPathsInPolygon(paths: readonly (readonly number[])[], polygon: readonly number[], share?: number): boolean;
}
