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

