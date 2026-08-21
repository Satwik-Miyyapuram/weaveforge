import type { ReaderAnnotation } from "@weaveforge/core";
import type { ReaderCreateTool } from "../../application/reader-annotation-helpers";

/**
 * Below this (PDF user-space units, ≈ points) a text-box drag is treated as a
 * tap and the default box size is used instead — dragging a few pixels by
 * accident should not produce an invisible annotation.
 */
export const MIN_TEXT_BOX_PDF_SIZE = 8;

/**
 * What the armed tool will do on release. "Clip a region" and "Write a note"
 * are both a dragged rectangle and look the same mid-drag, so the difference
 * has to be stated rather than inferred.
 */
export const CREATE_TOOL_HINTS: Record<ReaderCreateTool, string> = {
  select: "Drag across text to highlight it. Drag a selected ink mark to move it.",
  ink: "Draw freehand. Strokes drawn together stay one annotation.",
  highlighter: "Sweep over the page with a broad translucent nib.",
  erase: "Drag over ink to delete it.",
  image: "Drag a box to clip that part of the page as a picture.",
  text: "Drag a box, then type a note to sit there.",
};

/** How close, in PDF units, the eraser must pass to a stroke to remove it. */
export const ERASER_RADIUS = 6;

/**
 * How far a drag must travel before it counts as moving an ink mark rather than
 * a click that selects it.
 */
export const INK_MOVE_THRESHOLD = 2;

/** Stable empty array — a fresh `[]` per page would defeat memoisation. */
export const EMPTY_ANNOTATIONS: ReaderAnnotation[] = [];
