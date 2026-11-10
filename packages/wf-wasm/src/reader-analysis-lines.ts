/**
 * Text lines, column detection and running-head keys (reader analysis), backed
 * by Rust. Offsets are UTF-16 code units, as in the TS copy. Rust returns column
 * and reading-order indices; `sortByReadingOrder` maps them back to the caller's
 * objects. The `keep` predicate of `reconstructLines` runs here, in TS, and its
 * per-run verdicts cross to Rust as flags.
 */
import {
  pageTextFromItems as rawPageTextFromItems,
  reconstructLines as rawReconstructLines,
  detectColumns as rawDetectColumns,
  sortByReadingOrder as rawSortByReadingOrderIndices,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisTextLine as TextLine,
} from "./bindings.js";

export {
  furnitureKey,
  isBoldFont,
} from "../pkg/wf_wasm.js";

/** Items concatenated, `\n` after each `hasEOL` item (Rust `page_text_from_items`). */
export function pageTextFromItems(items: readonly { str: string; hasEOL?: boolean }[]): string {
  return rawPageTextFromItems(items) as string;
}

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

/** Column index (0-based) for each line, all on one page (Rust `detect_columns`). */
export function detectColumns(lines: readonly TextLine[]): number[] {
  return rawDetectColumns(lines) as number[];
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
