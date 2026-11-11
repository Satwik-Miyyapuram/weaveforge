/** Types for zoom. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * The one zoom table for ink: the note canvas and the ink reader, through
 * every input (bar buttons, presets, keys, wheel and pinch).
 */

/** Smallest ink zoom: half size. */
export const INK_ZOOM_MIN = 0.5;

/** Largest ink zoom: four times. */
export const INK_ZOOM_MAX = 4;

/** One zoom-in or zoom-out step, as a factor. */
export const INK_ZOOM_STEP = 1.25;

