/**
 * Highlight rect normalisation (Rust `normalize_highlight_rects`), re-exported from index.ts. Keeps the
 * signature of apps/web/src/features/reader/application/normalize-highlight-rects.ts.
 */
import { normalizeHighlightRects as rawNormalizeHighlightRects } from "../pkg/wf_wasm.js";

/**
 * One clean band per line of a text highlight. Rects are PDF user space, `[x1, y1, x2, y2]` with a
 * bottom-left origin. Invalid rects are dropped.
 */
export function normalizeHighlightRects(rects: readonly (readonly number[])[]): number[][] {
  return rawNormalizeHighlightRects(rects) as number[][];
}
