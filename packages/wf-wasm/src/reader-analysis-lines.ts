/**
 * Text lines, column detection and running-head keys (reader analysis), backed
 * by Rust. Offsets are UTF-16 code units, as in the TS copy. Rust returns column
 * and reading-order indices; `sortByReadingOrder` maps them back to the caller's
 * objects. The `keep` predicate of `reconstructLines` runs here, in TS, and its
 * per-run verdicts cross to Rust as flags.
 */
import {
  reconstructLines as rawReconstructLines,
  sortByReadingOrder as rawSortByReadingOrderIndices,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisTextLine as TextLine,
} from "./bindings.js";

export {
  detectColumns,
} from "../pkg/wf_wasm.js";

export {
  furnitureKey,
  isBoldFont,
} from "../pkg/wf_wasm.js";

export {
  pageTextFromItems,
} from "../pkg/wf_wasm.js";

/**
 * One page's runs as lines, in the page's own order (Rust `reconstruct_lines`).
 * `keep` is applied to each non-blank run, as the TS copy did.
 */
export function reconstructLines(
  page: number,
  items: readonly { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }[],
  keep: (item: { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }) => boolean = () => true,
): TextLine[] {
  const flags = items.map((item) => !!item.str.trim() && keep(item));
  return rawReconstructLines(page, items, flags) as TextLine[];
}

/**
 * Reading order over column-tagged lines: page, then column, then top to bottom.
 * Returns the caller's own line objects (Rust `sort_by_reading_order_indices`).
 */
export function sortByReadingOrder<T extends TextLine>(
  tagged: readonly { line: T; column: number }[],
): T[] {
  const order = rawSortByReadingOrderIndices(tagged) as number[];
  return order.map((index) => tagged[index]!.line);
}
