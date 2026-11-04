/**
 * Text-selection anchors and text-item rects (`packages/core/src/reader/selection-to-anchor.ts`),
 * backed by Rust. Offsets are UTF-16 code units, as in the TS copy. Re-exported from index.ts.
 */
import {
  selectionToAnchor as rawSelectionToAnchor,
  itemToRect as rawItemToRect,
} from "../pkg/wf_wasm.js";
import type {
  AnchorCombinedPdf as CombinedPdfAnchor,
  SelectionPageTextGeometry as PageTextGeometry,
  SelectionPageTextItem as PageTextItem,
  SelectionTextRange as TextSelectionRange,
} from "./bindings.js";

/**
 * Convert a text-layer selection into a CombinedPdfAnchor, or `null` when the selection is
 * empty or out of range (Rust `selection_to_anchor`).
 */
export function selectionToAnchor(
  selection: TextSelectionRange,
  page: Omit<PageTextGeometry, "items"> & { items?: readonly PageTextItem[] },
): CombinedPdfAnchor | null {
  return rawSelectionToAnchor(selection, page) as CombinedPdfAnchor | null;
}

/**
 * pdf.js text-item transform to a PDF user-space rect `[x1, y1, x2, y2]`, narrowed to
 * `charFrom`..`charTo`; `null` when there is no renderable geometry (Rust `item_to_rect`).
 */
export function itemToRect(
  item: PageTextItem,
  charFrom = 0,
  charTo = Number.POSITIVE_INFINITY,
): number[] | null {
  return rawItemToRect(item, charFrom, charTo) as number[] | null;
}
