/**
 * The status bar's document numbers (Rust `editor_workspace::document_stats`),
 * re-exported from index.ts.
 */
import {
  bodyStats as rawBodyStats,
  formatCount as rawFormatCount,
  formatWords as rawFormatWords,
  formatCursorLabel as rawFormatCursorLabel,
} from "../pkg/wf_wasm.js";
import type { BodyStats } from "./bindings.js";

/** Words (whitespace runs) and characters (UTF-16 units) in a body. */
export function bodyStats(body: string): BodyStats {
  return rawBodyStats(body) as BodyStats;
}

/** A count with thousands grouped by a thin space. */
export function formatCount(value: number): string {
  return rawFormatCount(value);
}

/** "1 word · 1 min read"; no reading time at zero. */
export function formatWords(words: number): string {
  return rawFormatWords(words);
}

/** "Ln 7, Col 4", from a 1-based line and column. */
export function formatCursorLabel(line: number, col: number): string {
  return rawFormatCursorLabel(line, col);
}

/** "Ln 7, Col 4". */
export function formatCursor(cursor: { line: number; col: number }): string {
  return rawFormatCursorLabel(cursor.line, cursor.col);
}
