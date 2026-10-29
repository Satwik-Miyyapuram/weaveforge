import type { ReaderAnnotation } from "@weaveforge/core";

/**
 * Below this (PDF user-space units, ≈ points) a text-box drag is treated as a
 * tap and the default box size is used instead — dragging a few pixels by
 * accident should not produce an invisible annotation.
 */
export const MIN_TEXT_BOX_PDF_SIZE = 8;

/**
 * How far a drag must travel before it counts as moving an ink mark rather than
 * a click that selects it.
 */
export const INK_MOVE_THRESHOLD = 2;

/** Stable empty array — a fresh `[]` per page would defeat memoisation. */
export const EMPTY_ANNOTATIONS: ReaderAnnotation[] = [];
