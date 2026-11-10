/**
 * Citation text helpers (Rust `reader_analysis::text`), re-exported from index.ts. Each function keeps
 * the signature and defaults of CitationTextFns, TextFingerprintFns and TitleSimilarityFns in\n * packages/core/src/shared/core-contract.ts. Object shapes come from ./bindings.ts.
 *
 * `itemToRect` is exported here as `citationItemToRect`: that name is taken by another lane.
 */
import {
  searchTextFromItems as rawSearchTextFromItems,
  citationItemToRect as rawCitationItemToRect,
  mentionRects as rawMentionRects,
  rectanglesOverlap as rawRectanglesOverlap,
  textFingerprint as rawTextFingerprint,
  isBibliographicMatch as rawIsBibliographicMatch,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisPdfItem,
  AnalysisSearchText,
} from "./bindings.js";

export {
  composeSpacingAccents,
  fontSizeOf,
  originalRange,
  stripInvisible,
  surnameKey,
  titleSimilarity,
} from "../pkg/wf_wasm.js";

/** Normalised search text where every unit maps back to its raw span. */
export function searchTextFromItems(items: readonly AnalysisPdfItem[]): AnalysisSearchText {
  return rawSearchTextFromItems(items) as AnalysisSearchText;
}

/** The PDF rect `[x0, y0, x1, y1]` of `item.str[from..to]`, or null. */
export function citationItemToRect(item: AnalysisPdfItem, from = 0, to = item.str.length): number[] | null {
  return rawCitationItemToRect(item, from, to) as number[] | null;
}

/** The PDF rects covering the normalised span `start..end`. */
export function mentionRects(items: readonly AnalysisPdfItem[], start: number, end: number): number[][] {
  return rawMentionRects(items, start, end) as number[][];
}

/** True if two rects `[x0, y0, x1, y1]` overlap with positive area. */
export function rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return rawRectanglesOverlap(Float64Array.from(a), Float64Array.from(b));
}

/** Sixteen hex characters from two FNV-1a passes over the text layer. */
export function textFingerprint(texts: readonly string[]): string {
  return rawTextFingerprint(texts);
}

/** True when the titles are at least 0.85 similar and the years differ by at most one. */
export function isBibliographicMatch(
  hints: { title?: string | null; year?: number | null },
  candidate: { title: string; year?: number | null },
): boolean {
  return rawIsBibliographicMatch(hints, candidate);
}
