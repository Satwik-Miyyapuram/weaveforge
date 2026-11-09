/** Types for column-detection. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { TextLine } from "./line-reconstruction.js";

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ColumnDetectionFns {
  /**
 * Column index (0-based) for each supplied line, all on one page. Lines whose
 * margin fits no dominant column take the nearest one, so a paragraph indent
 * never spawns a column of its own.
 */
  detectColumns(lines: readonly TextLine[]): number[];
  /**
 * Reading order over already-column-tagged lines: page, then column, then top
 * to bottom (PDF baselines grow upward, so larger `y` first).
 */
  sortByReadingOrder<T extends TextLine>(tagged: readonly { line: T; column: number }[]): T[];
}
