/**
 * The status bar's document numbers (Rust `editor_workspace::document_stats`),
 * re-exported from index.ts.
 */
import {
  formatCursorLabel as rawFormatCursorLabel,
} from "../pkg/wf_wasm.js";

export {
  bodyStats,
  formatCount,
  formatCursorLabel,
  formatWords,
} from "../pkg/wf_wasm.js";

/** "Ln 7, Col 4". */
export function formatCursor(cursor: { line: number; col: number }): string {
  return rawFormatCursorLabel(cursor.line, cursor.col);
}
