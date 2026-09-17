/**
 * Shape snap: the freehand mark that becomes the figure the user meant to draw.
 *
 * §6.3 gives the Shape tool one job — "rough line / rect / ellipse / arrow, hold
 * 400 ms → snapped; `shape` field" — and this module is the *pure geometry* half
 * of it. It answers exactly one question: given the samples the pen produced,
 * which of the four primitives was that, and what are its parameters? The hold
 * timer, the gesture arbitration, the preview and the mutation of the stroke are
 * the host's business; nothing here reads a clock, a pointer event or React.
 *
 * **Six judgements in one place, and a confidence that says how close the call
 * was.** §7 step 8 asks for figures "drawn, tidied and exported", so a wrong snap
 * is worse than no snap: the user then has to undo a correction they did not ask
 * for. This module therefore fits *all four* primitives and returns the best one
 * only when it is both inside the acceptance band and ahead of its closest rival
 * by {@link SHAPE_ACCEPT_MARGIN}. An ambiguous mark — and a rough square is
 * ambiguous, because it is also a terrible circle — is left alone. `"none"` is a
 * first-class result, not a failure.
 *
 * **Closed-form only, because this runs on the pen path.** No dependency, no
 * iteration to a tolerance, no training data: the line is a least-squares fit,
 * the axis-aligned rectangle is a band test in the page frame, the ellipse is a
 * moment (principal-axis) fit scored by radial residual, and the arrow is a
 * corner test on the widest pair of segments. Each takes one pass over the
 * samples, so a snap can run inside the 400 ms hold without a frame budget of
 * its own.
 *
 * **The four gates are pre-filters, and they are deliberately strict.** A line
 * whose samples double back on themselves is an arrow or a letter, never a line;
 * a closed shape that never closes cannot be a rect or an ellipse; an ellipse
 * needs a point cloud with two spread axes before "eccentricity" means anything.
 * Gating first is what keeps the ellipse fit from snapping a scribble, which has
 * a perfectly serviceable principal axis and a residual that says so.
 *
 * **Every path here keeps the user's first and last samples as its endpoints.**
 * A snap clarifies the middle of a mark; it does not move where the pen went
 * down or came up. For a line the endpoints are kept and the interior is
 * projected onto the fit, so a hand-drawn line becomes straight without getting
 * shorter by the length of the wobble. For a closed shape the path *is* closed,
 * so the first sample is the seam and the last one lands back on it.
 *
 * Coordinates are absolute integers in 0.1 mm, the same unit as
 * `core/ink/ink-note.ts` and `application/one-euro-filter.ts`: a point is a pair
 * of numbers, so a path is a flat `[x0, y0, x1, y1, …]` array and never an array
 * of objects. The unit is load-bearing for the thresholds below — 10 units is a
 * millimetre, and 1 unit is a tenth of one, which is below what the eye resolves
 * at 100 % zoom on the target hardware (§4.4), so an error expressed as a
 * fraction of the mark's own span is scale-free and needs no calibration.
 */
/* -------------------------------------------------------------------------
 * The public surface
 *
 * The module's own seams, as a folder: `geometry` is the vocabulary, the
 * thresholds and the reading helpers; `line`, `rect`, `ellipse` and `arrow`
 * are the four fits; `fit` is the choice between them and the paths a
 * renderer draws. This file carries the banner whole and re-exports every
 * name callers have always imported from `shape-snap`, so the door is
 * unchanged.
 * ---------------------------------------------------------------------- */

export * from "./geometry";
export * from "./line";
export * from "./rect";
export * from "./ellipse";
export * from "./arrow";
export * from "./fit";
