/**
 * Local annotation drafts (Rust `reader::annotation_draft`), re-exported from
 * index.ts. The draft, anchor and mark types come from ./bindings.ts.
 */
import {
  draftFromTextSelection as rawDraftFromTextSelection,
  draftInkAnnotation as rawDraftInkAnnotation,
  appendInkStroke as rawAppendInkStroke,
  eraseInkPaths as rawEraseInkPaths,
  draftImageRegion as rawDraftImageRegion,
  draftTextBox as rawDraftTextBox,
} from "../pkg/wf_wasm.js";
import type { NewReaderAnnotation } from "@weaveforge/core";
import type { CombinedPdfAnchor } from "./reader-types.js";
import type {
  ImageRegionDraft,
  InkDraft,
  TextBoxDraft,
  TextSelectionDraft,
} from "./bindings.js";

export { grownTextRect, textBoxFromRect } from "../pkg/wf_wasm.js";

/** The mark for a text selection, or null when it has no placeable text. */
export function draftFromTextSelection(input: TextSelectionDraft): NewReaderAnnotation | null {
  return rawDraftFromTextSelection(input) as NewReaderAnnotation | null;
}

/** The ink mark to save, or null when nothing was drawn. */
export function draftInkAnnotation(input: InkDraft): NewReaderAnnotation | null {
  return rawDraftInkAnnotation(input) as NewReaderAnnotation | null;
}

/** The anchor with one more ink path, or null for a stroke too short to keep. */
export function appendInkStroke(anchor: CombinedPdfAnchor, path: number[]): CombinedPdfAnchor | null {
  return rawAppendInkStroke(anchor, path) as CombinedPdfAnchor | null;
}

/** The anchor with the ink paths under the eraser removed, or null when all were removed. */
export function eraseInkPaths(
  anchor: CombinedPdfAnchor,
  x: number,
  y: number,
  radius: number,
): CombinedPdfAnchor | null {
  return rawEraseInkPaths(anchor, x, y, radius) as CombinedPdfAnchor | null;
}

/** A region mark, or null for an empty region. */
export function draftImageRegion(input: ImageRegionDraft): NewReaderAnnotation | null {
  return rawDraftImageRegion(input) as NewReaderAnnotation | null;
}

/** A text-box mark. */
export function draftTextBox(input: TextBoxDraft): NewReaderAnnotation {
  return rawDraftTextBox(input) as NewReaderAnnotation;
}
