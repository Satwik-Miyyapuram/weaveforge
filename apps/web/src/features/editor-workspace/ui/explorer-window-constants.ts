/**
 * Explorer row metrics (M04). The Rust row-window core (`rowSlots`) picks the
 * painted rows from these; the UI reads the row height for layout.
 */
import type { RowMetrics } from "@weaveforge/wasm";

/** One row's height, matching `.explorer-row` in editor-workspace.css. */
export const EXPLORER_ROW_PX = 25;
/** Painted before the panel has a size to measure: more than a screenful. */
export const EXPLORER_FIRST_PAINT_ROWS = 60;
/** Painted past each edge of the view, so a scroll never shows a blank row. */
export const EXPLORER_OVERSCAN_ROWS = 12;

/** The metrics passed to the core's `rowSlots` on every call. */
export const EXPLORER_ROW_METRICS: RowMetrics = {
  rowPx: EXPLORER_ROW_PX,
  firstPaintRows: EXPLORER_FIRST_PAINT_ROWS,
  overscanRows: EXPLORER_OVERSCAN_ROWS,
};
